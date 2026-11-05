/**
 * Runtime context shared by every command: resolved network, RPC, output mode,
 * and lazy read/wallet clients built from config + global flags.
 */
import { createHoodClient, type HoodClient, type HoodNetwork } from 'hoodchain'
import { privateKeyToAccount } from 'viem/accounts'
import { http, isHex } from 'viem'
import { loadConfig, defaultKeystorePath, type HoodConfig } from './config.js'
import { decryptKeystore, keystoreExists } from './keystore.js'
import { readPassword } from './prompt.js'
import { usageError, walletError } from './errors.js'

/** Global flags parsed by commander and threaded into every command. */
export interface GlobalOptions {
  json?: boolean
  network?: HoodNetwork
  rpc?: string
  verbose?: boolean
  yes?: boolean
  acknowledgeEligibility?: boolean
}

export interface Context {
  config: HoodConfig
  network: HoodNetwork
  json: boolean
  verbose: boolean
  /** `--yes`: skip the interactive confirm on writes (still requires `--execute`). */
  assumeYes: boolean
  /** `--acknowledge-eligibility`: operator affirms non-US Stock-Token eligibility. */
  acknowledgeEligibility: boolean
  /** A read-only client (cached). */
  read(): HoodClient
  /** A wallet-backed client (loads + decrypts the key on first use). */
  wallet(): Promise<HoodClient>
  /** The resolved RPC URL, if any (else the SDK public default). */
  rpcUrl?: string
}

/** Resolve the RPC URL from flags → config → SDK default (undefined). */
export function resolveRpcUrl(config: HoodConfig, network: HoodNetwork, override?: string): string | undefined {
  if (override) return override
  if (network === 'testnet') return config.testnetRpc
  if (config.alchemyKey) return `https://robinhood-mainnet.g.alchemy.com/v2/${config.alchemyKey}`
  return config.rpc
}

/**
 * The public RPC throttles bursty callers (log scans, wide multicalls) with
 * 429s. viem's http() default retry (3 attempts, ~150ms base) gives up too
 * fast for that — widen it so `hood stocks` / `hood launches` ride out a
 * rate-limit window instead of surfacing a network error to the user.
 */
function resolveRpcHeaders(): Record<string, string> | undefined {
  const raw = process.env.HOOD_RPC_HEADERS
  if (raw === undefined || raw.trim() === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw rpcHeadersUsageError()
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw rpcHeadersUsageError()
  }

  const headers = new Headers()
  try {
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') throw rpcHeadersUsageError()
      headers.append(name, value)
    }
  } catch (error) {
    if (error instanceof Error && error.message === RPC_HEADERS_ERROR) throw error
    throw rpcHeadersUsageError()
  }
  return Object.keys(parsed).length === 0 ? undefined : Object.fromEntries(headers.entries())
}

const RPC_HEADERS_ERROR = 'HOOD_RPC_HEADERS must be a JSON object with valid HTTP header names and string values.'

function rpcHeadersUsageError() {
  return usageError(RPC_HEADERS_ERROR)
}

function buildTransport(rpcUrl: string | undefined, headers?: Record<string, string>) {
  return http(rpcUrl, {
    retryCount: 5,
    retryDelay: 500,
    timeout: 20_000,
    ...(headers ? { fetchOptions: { headers, redirect: 'error' as const } } : {}),
  })
}

/** Build the shared context from the global flags. */
export function createContext(opts: GlobalOptions): Context {
  const rpcHeaders = resolveRpcHeaders()
  const config = loadConfig()
  const network: HoodNetwork = opts.network ?? config.network ?? 'mainnet'
  const rpcUrl = resolveRpcUrl(config, network, opts.rpc)
  if (rpcHeaders && !rpcUrl) {
    throw usageError('HOOD_RPC_HEADERS requires an explicit RPC URL via --rpc, config, or the existing Alchemy URL.')
  }
  const transport = buildTransport(rpcUrl, rpcHeaders)

  let readClient: HoodClient | null = null
  let walletClient: HoodClient | null = null

  return {
    config,
    network,
    json: !!opts.json,
    verbose: !!opts.verbose,
    assumeYes: !!opts.yes,
    acknowledgeEligibility: !!opts.acknowledgeEligibility,
    rpcUrl,
    read() {
      if (!readClient) {
        readClient = createHoodClient({ chain: network, transport })
      }
      return readClient
    },
    async wallet() {
      if (walletClient) return walletClient
      const account = await loadAccount(config)
      walletClient = createHoodClient({
        chain: network,
        transport,
        account,
        acknowledgeStockTokenEligibility: !!opts.acknowledgeEligibility,
      })
      return walletClient
    },
  }
}

/**
 * Resolve the signing account. Precedence:
 * 1. `ROBINHOOD_CHAIN_PRIVATE_KEY` env var (CI / power users).
 * 2. The encrypted keystore configured with `hood config set wallet`.
 */
async function loadAccount(config: HoodConfig) {
  const envKey = process.env.ROBINHOOD_CHAIN_PRIVATE_KEY
  if (envKey) {
    const key = envKey.startsWith('0x') ? envKey : `0x${envKey}`
    if (!isHex(key) || key.length !== 66) {
      throw walletError('ROBINHOOD_CHAIN_PRIVATE_KEY is not a valid 32-byte hex key.')
    }
    return privateKeyToAccount(key as `0x${string}`)
  }

  const keystorePath = config.walletKeystore ?? defaultKeystorePath()
  if (!keystoreExists(keystorePath)) {
    throw walletError('No wallet configured.', 'Run `hood config set wallet`, or set ROBINHOOD_CHAIN_PRIVATE_KEY.')
  }
  const password = await readPassword()
  const privateKey = decryptKeystore(keystorePath, password)
  return privateKeyToAccount(privateKey)
}
