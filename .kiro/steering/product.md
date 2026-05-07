---
inclusion: always
---

# ChainLens — Product Overview

ChainLens is a **Web2-data relay market** for autonomous agents on Base.
Agents discover verified data sellers, pay in USDC through escrow (v2) or
x402 settlement (v3), and receive schema-validated, hash-committed
responses in one round-trip — no API keys, no OAuth, just a wallet.

## Core value proposition

Every request follows a fixed lifecycle that makes seller responses
independently verifiable:

1. Buyer pays (USDC escrow or x402 authorization).
2. Gateway calls seller HTTP endpoint, validates the response against the
   task type's JSON schema, scans for prompt injection, computes
   `keccak256(response)` as `responseHash`.
3. On success, gateway settles on-chain and records reputation.
4. Any client can re-fetch evidence and recompute the hash to audit.

## Task types (initial)

- `blockscout_contract_source` — verified contract source + ABI
- `blockscout_tx_info` — transaction details
- `defillama_tvl` — protocol TVL breakdown
- `sourcify_verify` — bytecode verification status
- `chainlink_price_feed` — on-chain price oracle read

Each task type has a JSON schema enforced before `responseHash` is
committed. Bad responses auto-refund and penalize seller reputation.

## Primary users

- **Buyers / Agents** — MCP tool (`@chain-lens/mcp-tool`) or plain x402
  HTTP clients.
- **Sellers** — operators of wrapper endpoints that translate the gateway
  POST shape into their upstream API.
- **Evidence auditors** — anyone verifying a past job's response hash.
