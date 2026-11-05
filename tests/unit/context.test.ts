import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createContext } from '../../src/context.js'

const SENTINEL = 'synthetic-header-sentinel-7f31'
const TEST_PRIVATE_KEY = `0x${'1'.padStart(64, '0')}` as const
const originalEnv = new Map<string, string | undefined>()

function setEnv(name: string, value: string | undefined): void {
  if (!originalEnv.has(name)) originalEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  originalEnv.clear()
})

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server: Server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server did not bind a TCP port.')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

function rpcResponse(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2a' }))
}

function isolateConfig(): void {
  setEnv('HOOD_CONFIG_DIR', `/tmp/hood-cli-header-test-${randomUUID()}`)
}

describe('HOOD_RPC_HEADERS', () => {
  it.each([
    ['not-json', 'not-json'],
    ['array', '[]'],
    ['null', 'null'],
    ['non-string value', '{"x-api-key":7}'],
    ['invalid name', '{"bad header":"x"}'],
    ['invalid value', '{"x-api-key":"line\\r\\nbreak"}'],
  ])('rejects %s without exposing input or making a request', async (_label, value) => {
    isolateConfig()
    setEnv('HOOD_RPC_HEADERS', value)
    let requests = 0
    const endpoint = await listen((_request, response) => {
      requests++
      rpcResponse(response)
    })
    try {
      let thrown: unknown
      try {
        createContext({ rpc: endpoint.url })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toMatch(/HOOD_RPC_HEADERS.*JSON object/)
      expect((thrown as Error).message).not.toContain(value)
      expect(requests).toBe(0)
    } finally {
      await endpoint.close()
    }
  })

  it.each(['', '   ', '{}'])('leaves the transport unconfigured for empty input %j', async (value) => {
    isolateConfig()
    setEnv('HOOD_RPC_HEADERS', value)
    const seen: string[] = []
    const endpoint = await listen((request, response) => {
      seen.push(request.headers['x-api-key'] ?? '')
      rpcResponse(response)
    })
    try {
      const result = await createContext({ rpc: endpoint.url }).read().public.getBlockNumber()
      expect(result).toBe(42n)
      expect(seen).toEqual([''])
    } finally {
      await endpoint.close()
    }
  })

  it('uses the same header transport for read and wallet clients', async () => {
    isolateConfig()
    setEnv('HOOD_RPC_HEADERS', JSON.stringify({ 'x-api-key': SENTINEL }))
    setEnv('ROBINHOOD_CHAIN_PRIVATE_KEY', TEST_PRIVATE_KEY)
    const seen: string[] = []
    const endpoint = await listen((request, response) => {
      seen.push(request.headers['x-api-key'] ?? '')
      rpcResponse(response)
    })
    try {
      const context = createContext({ rpc: endpoint.url })
      expect(await context.read().public.getBlockNumber()).toBe(42n)
      expect(await (await context.wallet()).public.getBlockNumber()).toBe(42n)
      expect(seen).toEqual([SENTINEL, SENTINEL])
    } finally {
      await endpoint.close()
    }
  })

  it('requires an explicit RPC URL and rejects redirects when headers are configured', async () => {
    isolateConfig()
    setEnv('HOOD_RPC_HEADERS', JSON.stringify({ 'x-api-key': SENTINEL }))
    expect(() => createContext({})).toThrow(/requires an explicit RPC URL/)

    let targetRequests = 0
    const endpoint = await listen((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: `${endpoint.url}/target` })
        response.end()
      } else {
        if (request.url === '/target') targetRequests++
        rpcResponse(response)
      }
    })
    try {
      await expect(createContext({ rpc: `${endpoint.url}/redirect` }).read().public.getBlockNumber()).rejects.toThrow()
      expect(targetRequests).toBe(0)
    } finally {
      await endpoint.close()
    }
  }, 40_000)

  it('keeps default redirect behavior and sends no custom header when unset', async () => {
    isolateConfig()
    setEnv('HOOD_RPC_HEADERS', undefined)
    const seen: Array<{ path: string; key: string }> = []
    const endpoint = await listen((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: `${endpoint.url}/target` })
        response.end()
        return
      }
      seen.push({ path: request.url ?? '', key: request.headers['x-api-key'] ?? '' })
      rpcResponse(response)
    })
    try {
      expect(await createContext({ rpc: `${endpoint.url}/redirect` }).read().public.getBlockNumber()).toBe(42n)
      expect(seen).toEqual([{ path: '/target', key: '' }])
    } finally {
      await endpoint.close()
    }
  })
})
