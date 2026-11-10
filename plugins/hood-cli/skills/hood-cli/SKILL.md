---
name: hood-cli
description: Run the hood command-line toolkit for Robinhood Chain (chain 4663) to read prices, portfolios, launches and transactions, and to quote or send guarded swaps and transfers. Use when asked to look something up on Robinhood Chain from a terminal.
---

# hood-cli for Robinhood Chain

`hood-cli` is published on npm. It installs two identical bins, `hood` and `hoodc`. Run it without installing:

```
npx -y -p hood-cli hood <command>
```

Reads need no config and no wallet. Add `--json` to any command for machine-readable output, `--network testnet` for the testnet (default `mainnet`) and `--rpc <url>` to override the RPC.

## Read commands (safe)

| Command | What it does |
| --- | --- |
| `hood price <symbol>` | Chainlink oracle price, DEX price and premium for a Stock Token ticker or address. Flags: `--watch`, `--interval <ms>`, `--max-age <seconds>`, `--no-dex`. |
| `hood stocks` | Stock Token board. Flags: `--sort symbol\|price\|premium`, `--dex`, `--priced`, `--limit <n>`. |
| `hood portfolio <address>` | Multiplier-correct Stock Token positions and USD totals. |
| `hood token <address>` | Token metadata, supply, multiplier and price. Accepts a ticker. |
| `hood tx <hash>` | Decode a transaction: status, transfers, gas, method. |
| `hood coins` | Memecoin screener. Flags: `--new`, `--trending`, `--lookback <blocks>`, `--limit <n>`, `--names`. |
| `hood launches` | Recent launches from NOXA and The Odyssey. Flags: `--follow`, `--launchpad noxa\|odyssey`, `--lookback`, `--limit`, `--names`. |
| `hood watch <addrOrToken>` | Live ERC-20 and ETH activity stream. `--token` treats the argument as a token. |
| `hood faucet` | Prints testnet faucet instructions and testnet balances. |

## Write commands (spend funds)

`hood swap` quotes by default: `hood swap --sell USDG --buy AAPL --amount 10 --slippage 50`. Adding `--execute` signs and sends a Uniswap v3 swap. `hood transfer --to <address> --amount <n> [--token <ticker|address>]` sends ETH or an ERC-20 and asks for confirmation. `hood deploy-token --config <file.json>` prints a deploy plan for a fixed-supply ERC-20 (`{ name, symbol, decimals?, initialSupply }`) and only deploys with `--execute`.

Signing needs a wallet: run `hood config set wallet` in your own terminal, or export `ROBINHOOD_CHAIN_PRIVATE_KEY` in your shell before starting Claude Code. Never ask the user to paste a key into the chat. `hood config set maxSpendUsd <n>` sets a per-command spend cap.

Rules for the agent:

1. Quote first. Run `hood swap` without `--execute` and show the user the quote.
2. Before any `--execute`, `hood transfer` or `hood deploy-token --execute`, show recipient, amount, token and network, then stop and wait for an explicit yes.
3. Never pass `--yes` (skips the prompt) or `--acknowledge-eligibility` (affirms Stock Token acquisition eligibility for non-US/CA/UK/CH persons) on the user's behalf. Those are the user's decisions.

## Example

Request: "What is AAPL trading at on Robinhood Chain, and how far is the DEX from the oracle?"

```
npx -y -p hood-cli hood price AAPL --json
```

Report the oracle price, the DEX price and the premium from the output. If the oracle answer is stale, rerun with a larger `--max-age`.
