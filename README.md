# ChainLens

> Agent-native API marketplace on Base. Agents discover verified data sellers,
> pay in USDC over **x402**, and receive schema-validated responses in one
> round-trip — no API keys, no OAuth, just a wallet. Powered by **AWS Bedrock
> + Claude Sonnet 4.5** for AI-assisted seller insights.

**Coinbase × AWS Agentic Hackathon — Consensus Miami 2026 submission**

---

## 🎬 Demo

<a href="https://www.youtube.com/watch?v=QlzaoXJS9S4">
  <img src="https://img.youtube.com/vi/QlzaoXJS9S4/maxresdefault.jpg" alt="ChainLens demo" width="600">
</a>

> Full walk-through with audio (16 min) — discover, inspect, pay-on-call, verify on-chain, plus the AI Market Analyst SaaS for sellers. [▶ Watch on YouTube](https://www.youtube.com/watch?v=QlzaoXJS9S4)

**Chapters:**

- `00:00` [Agent Purchase API Demo](https://youtu.be/QlzaoXJS9S4?t=0)
- `05:44` [Using Bedrock Seller Analytic Service](https://youtu.be/QlzaoXJS9S4?t=344)
- `15:37` [Using Bedrock Seller Analytic Service (cont.)](https://youtu.be/QlzaoXJS9S4?t=937)

**Live demo:** https://chainlens.pelicanlab.dev

---

## ✨ Highlights

- **x402 payment rail** — buyers sign EIP-3009 `ReceiveWithAuthorization`,
  the gateway settles on `ChainLensMarket.settle()` only **after** the seller
  responds and passes schema validation. No upfront approvals, no escrow lock.
- **AI Analyst layer (AWS Bedrock + Claude Sonnet 4.5)** — natural-language
  trust + market analysis for any listing. Sellers buy a **premium analysis
  of their own listing for 0.5 USDC** through the same x402 path.
- **Reusable seller reputation** — `claimable[seller]` is pull-pattern and
  cumulative across all paid calls; every settlement is a public on-chain
  event.
- **Agent-first surface** — same listings consumable by browser users, the
  `@chain-lens/sdk` (Node), the MCP tool (Claude Desktop / Cursor), or any
  x402-aware HTTP client.

---

## 🖼 UI Screenshots

> Screenshots live in [`docs/screenshots/`](docs/screenshots) (add your own
> captures). Suggested shot list below.

| View | What it shows |
|---|---|
| `landing.png` | Landing hero + agent quickstart terminal |
| `discover.png` | Marketplace catalog with success-rate badges, category filter, on-chain trust signal |
| `discover-detail.png` | Listing detail — metadata, schema, recent policy signals, paid-test card |
| `seller-dashboard.png` | Seller dashboard with the **"Buy Market Analysis (0.5 USDC)"** CTA on each owned listing |
| `seller-buy-progress.png` | Live progress UI during a paid call — spinner + stage labels + elapsed timer + content skeleton |
| `seller-analysis-result.png` | Premium analysis card (trend, forecast, competitive positioning, pricing analysis, opportunities, risk factors, this-week / this-month action plan) |
| `admin-treasury.png` | Admin → **Treasury tab** with claimable balance, treasury wallet badge, `Claim X USDC` button |
| `basescan-settle.png` | Successful `settle()` tx on BaseScan with the listing fee + payout split visible |

---

## 🔗 Blockchain integration

Every paid call follows the same lifecycle on Base Sepolia:

```
Buyer wallet ─── EIP-3009 sig ───▶  Gateway ───▶  Seller HTTP endpoint
       ▲                                │                   │
       │  X-Payment header / inputs     │  validate, scan   │
       │                                ▼                   │
       │                         ChainLensMarket.settle()   │
       │                                │                   │
       │             5% fee ── claimable[treasury]          │
       │             95% net ─ claimable[payout]            │
       │                                │                   │
       └────────── response + settleTxHash ◀────────────────┘
```

### Live contracts (Base Sepolia)

| Contract | Address |
|---|---|
| `ChainLensMarket` (v3, x402-native) | [`0x45bB56fDB0E6bb14d178E417b67Ed7B3323ffFf7`](https://sepolia.basescan.org/address/0x45bB56fDB0E6bb14d178E417b67Ed7B3323ffFf7) |
| `ApiMarketEscrowV2` (legacy v2 escrow) | [`0xD4c40710576f582c49e5E6417F6cA2023E30d3aD`](https://sepolia.basescan.org/address/0xD4c40710576f582c49e5E6417F6cA2023E30d3aD) |
| `SellerRegistry` (ERC-8004 compatible) | [`0xcF36b76b5Da55471D4EBB5349A0653624371BE2c`](https://sepolia.basescan.org/address/0xcF36b76b5Da55471D4EBB5349A0653624371BE2c) |
| `TaskTypeRegistry` | [`0xD2ab227417B26f4d8311594C27c59adcA046501F`](https://sepolia.basescan.org/address/0xD2ab227417B26f4d8311594C27c59adcA046501F) |
| USDC (payment token) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

### `settle()` — the critical 30 lines

`ChainLensMarket.settle()` enforces the entire payment-and-fee logic in one
non-reentrant call (see [`packages/contracts/contracts/ChainLensMarket.sol`](packages/contracts/contracts/ChainLensMarket.sol)):

```solidity
function settle(uint256 listingId, bytes32 jobRef, address buyer,
                uint256 amount, /* EIP-3009 fields ... */ uint8 v, bytes32 r, bytes32 s)
    external onlyGateway nonReentrant
{
    require(amount > 0, "amount zero");
    Listing storage l = _listings[listingId];
    require(l.owner != address(0), "listing not found");
    require(l.active, "listing inactive");

    IERC20WithAuthorization(address(usdc)).receiveWithAuthorization(
        buyer, address(this), amount, validAfter, validBefore, nonce, v, r, s
    );

    uint256 fee = (amount * serviceFeeBps) / BPS_DIVISOR;
    uint256 sellerNet = amount - fee;

    claimable[l.payout] += sellerNet;          // pull-pattern, gas-bounded
    if (fee > 0) claimable[treasury] += fee;

    emit Settled(listingId, jobRef, buyer, l.payout, amount, fee);
}
```

Sellers and treasury both pull their accrued balance via the same `claim()`:

```solidity
function claim() external nonReentrant {
    uint256 amt = claimable[msg.sender];
    require(amt > 0, "nothing to claim");
    claimable[msg.sender] = 0;
    usdc.safeTransfer(msg.sender, amt);
    emit Claimed(msg.sender, amt);
}
```

---

## 🤖 AI Analyst layer (AWS Bedrock × Claude)

ChainLens uses AWS Bedrock to add **natural-language judgment** on top of
deterministic on-chain + operational data — without ever letting the LLM
gate a payment, a schema, or a settlement.

### Two surfaces, two models

| Surface | Caller | Model | Latency | Pricing |
|---|---|---|---|---|
| `GET /api/listings/:id/(trust\|market)-analysis` | Public, free, advisory | Claude Haiku 4.5 (Bedrock inference profile) | ~10s, 1h cached | Free, ChainLens absorbs cost |
| **AI Market Analyst by ChainLens** (paid x402 listing #18) | Sellers | Claude Haiku 4.5 with `depth=premium` prompt | ~10–12s per call | **0.5 USDC** to seller wallet, settled on-chain |

The premium output the seller pays for includes: trend + strength, multi-
sentence insight, forecast with numerical targets, competitive positioning,
pricing analysis, 3–5 tactical opportunities, risk factors, and a
this-week / this-month action plan. See
[`packages/backend/src/lib/market-analyzer.ts`](packages/backend/src/lib/market-analyzer.ts).

### How a seller buys an analysis

1. Seller opens **`/seller`**, sees the AI Market Analyst CTA on each owned
   listing card.
2. Click → wallet pops EIP-3009 signature for 0.5 USDC.
3. Gateway runs `ChainLensMarket.settle()` on listing #18 (whose endpoint is
   an `internal://market-analysis` sentinel — short-circuited to an
   in-process Bedrock call instead of a public HTTP fetch).
4. 5% fee accrues to `claimable[treasury]`, 95% accrues to ChainLens's
   payout — both addresses are the same treasury wallet for self-listing.
5. Result renders in-page with a fade-up animation.

### Why this design

- **Non-determinism stays in the right place.** LLMs are great at synthesis,
  bad at access control. Bedrock outputs influence buyer / seller decisions,
  never the gate.
- **No new contract.** Listing #18 is registered through the same `register()`
  every other seller uses, so SDK / MCP / x402 clients see it as just another
  paid endpoint. Hidden from the public catalog with a single
  `endpoint NOT LIKE 'internal://%'` filter.
- **Observability lives in the chain log.** Every paid analysis emits a
  `Settled` event — no parallel "AI usage" ledger to maintain.

---

## 📦 Monorepo layout

| Package | Purpose |
|---|---|
| [`packages/contracts`](packages/contracts) | `ChainLensMarket` (v3 x402), `ApiMarketEscrowV2` (legacy), registries. Hardhat + Ignition. |
| [`packages/backend`](packages/backend) | Express gateway: `/api/market/listings`, `/api/market/call/:id`, `/api/listings/:id/(trust\|market)-analysis`, `/api/x402/:id`, admin + seller endpoints. AWS Bedrock client lives in [`src/lib`](packages/backend/src/lib). |
| [`packages/frontend`](packages/frontend) | Next.js 15 marketplace + seller dashboard + admin Treasury tab + paid-call UI with skeleton/animation. |
| [`packages/shared`](packages/shared) | Contract ABIs, addresses, task type registry, chain configs. |
| [`packages/sdk`](packages/sdk) | `@chain-lens/sdk` — `chainlens.call(listingId, params)` + budget controls + telemetry. |
| [`packages/cli`](packages/cli) | `npx @chain-lens/cli` — quickstart wrapper. |
| [`packages/mcp-tool`](packages/mcp-tool) | MCP server: `chain-lens.discover` / `inspect` / `status` / `call` for Claude Desktop / Cursor. |

---

## 🚀 Quick start

```bash
pnpm install
cp .env.example .env                                  # PORT, PRIVATE_KEY, RPC_URL, AWS_*
docker compose up -d                                  # postgres + backend + frontend + nginx
docker compose logs -f backend
```

**Required env vars (root `.env`):**

```
DATABASE_URL=postgresql://postgres:...@db:5432/monapi
PRIVATE_KEY=0x...                                     # gateway / owner key (whitelist on settle())
CONTRACT_ADDRESS=0xD4c40710576f582c49e5E6417F6cA2023E30d3aD
RPC_URL=https://base-sepolia.g.alchemy.com/v2/<KEY>
JWT_SECRET=<32+ chars>

# AWS Bedrock (AI Analyst)
AWS_REGION=us-east-2
BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

**Live demo:** <https://chainlens.pelicanlab.dev>
**Marketplace:** <https://chainlens.pelicanlab.dev/discover>
**Seller dashboard:** <https://chainlens.pelicanlab.dev/seller>

---

## 🤝 Agent integration (MCP)

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "chain-lens": {
      "command": "npx",
      "args": ["-y", "@chain-lens/mcp-tool"],
      "env": {
        "CHAIN_LENS_API_URL": "https://chainlens.pelicanlab.dev/api",
        "CHAIN_ID": "84532",
        "RPC_URL": "https://base-sepolia.g.alchemy.com/v2/<YOUR_KEY>",
        "WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Tools:

- `chain-lens.discover` — search v3 listings via `GET /api/market/listings` (internal listings hidden automatically)
- `chain-lens.inspect` — deep-dive on one listing
- `chain-lens.status` — fetch evidence for a job id
- `chain-lens.call` — paid v3 x402 flow (any listing, including #18 for AI Market Analyst)
- `chain-lens.request` — legacy paid v2 escrow flow

`WALLET_PRIVATE_KEY` is optional; without it the agent can still discover,
inspect, and read status — just not spend.

---

## 💳 HTTP x402 endpoint

For x402-aware HTTP clients without the MCP package:

```bash
# 1. Probe terms (returns 402 with the ChainLens-specific payment requirements)
curl -i https://chainlens.pelicanlab.dev/api/x402/<listingId>

# 2. Sign a USDC ReceiveWithAuthorization for ChainLensMarket, base64url-encode,
#    retry with X-Payment header + inputs in the query string:
curl -H "X-Payment: <base64url-json>" \
  "https://chainlens.pelicanlab.dev/api/x402/<listingId>?protocol=lido"
```

Response shape:

```jsonc
{
  "jobRef": "0x...",
  "settleTxHash": "0x...",
  "delivery": "in-band",
  "untrusted_data": { /* seller response */ },
  "envelope": { /* host, listingId, jobRef */ },
  "safety": { "schemaValid": true, "warnings": [] }
}
```

The gateway settles on-chain only after schema + injection scan pass; failed
seller calls drop the signed authorization, so no USDC moves.

---

## 🛠 Becoming a seller

The `endpoint` registered in a listing is called **by the gateway**, not the
buyer. Each request arrives as:

```http
POST <your endpoint>
Content-Type: application/json

{
  "task_type": "<type>",
  "inputs": { ... },
  "jobId": "42",
  "buyer": "0x..."
}
```

Response must be JSON matching the `output_schema` in your listing's
metadata. Schema mismatches and prompt-injection hits trigger
`response_rejected_*` and the buyer's authorization is **never settled**.

Templates: [`packages/sample-sellers`](packages/sample-sellers) (Blockscout,
DeFiLlama, Sourcify wrappers).
Scaffold: `npx @chain-lens/create-seller init`.
Detailed flow: [`docs/BUYER_GUIDE.md`](docs/BUYER_GUIDE.md), [`docs/DEMO.md`](docs/DEMO.md).

---

## 🔒 Security posture

| Layer | Control |
|---|---|
| Contract | `ReentrancyGuard` + `SafeERC20`; gateway whitelist on `settle()`; `Ownable2Step` on registries; pause-aware. |
| Backend | Ajv schema validation on every seller response; injection scan before commit; 30s timeout per seller call; `response_rejected_*` short-circuits settlement. |
| Frontend | EIP-3009 signing client-side; users see `responseHash` + tx link to BaseScan; no private state. |
| LLM | Bedrock outputs are advisory only — never gate payment, schema, or admin actions. Auth check at boot; missing creds log a warning instead of crashing the gateway. |

---

## 🧰 Tech stack

- **Contracts:** Solidity 0.8.28, Hardhat, OpenZeppelin v5, Hardhat Ignition
- **Backend:** Express 4, Prisma 6 (PostgreSQL), viem, Ajv, pino, **`@aws-sdk/client-bedrock-runtime`**
- **Frontend:** Next.js 15, RainbowKit, wagmi, viem, Tailwind 3
- **Agent:** `@modelcontextprotocol/sdk` stdio server
- **Chain:** Base Sepolia (live)
- **Payment:** USDC (ERC-20, 6 decimals) over EIP-3009 ReceiveWithAuthorization
- **AI:** AWS Bedrock — Claude Haiku 4.5 inference profile (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)

---

## 🗺 Status

See [`PROGRESS.md`](PROGRESS.md) for the day-by-day build log. Type 2 MVP
infrastructure is fully implemented and tested (backend, MCP, sample
sellers, contracts). The AI Analyst layer + paid Market Analyst SaaS were
added for the Coinbase × AWS Agentic Hackathon.

## License

MIT
