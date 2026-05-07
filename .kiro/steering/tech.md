---
inclusion: always
---

# Tech stack & commands

## Stack

- **Contracts:** Solidity 0.8.28, Hardhat, Hardhat Ignition, OpenZeppelin v5
- **Backend:** Express 4, Prisma 6 (PostgreSQL), viem, Ajv, pino
- **Frontend:** Next.js 15, RainbowKit, wagmi, viem, Tailwind
- **Agent:** `@modelcontextprotocol/sdk` stdio server
- **Chain:** Base Sepolia (live) / Base Mainnet (TBD)
- **Payment token:** USDC (ERC-20, 6 decimals)
- **Package manager:** pnpm workspace + TypeScript 5.7

## Root scripts

```bash
pnpm install                # install all workspaces
pnpm dev                    # backend + frontend in parallel
pnpm build                  # shared → backend → frontend
pnpm test                   # all packages, recursive
pnpm contracts:compile      # hardhat compile
pnpm contracts:test         # hardhat test
pnpm db:migrate             # prisma migrate (backend)
pnpm db:studio              # prisma studio
pnpm format                 # prettier write
pnpm format:check           # prettier check
```

## Local setup

```bash
pnpm install
cp .env.example .env        # fill PLATFORM_URL, PRIVATE_KEY, DATABASE_URL
docker compose up -d        # postgres
pnpm --filter @chain-lens/backend db:migrate
pnpm dev
```

## Rules of thumb

- Use `pnpm --filter @chain-lens/<pkg> <script>` for per-package commands.
- Do not run `pnpm dev` or other long-running watchers from a tool call —
  ask the user to run them manually, or use `--run` / single-shot flags.
- Prefer `prisma migrate dev` in dev, `prisma migrate deploy` in CI.
- When adding a new task type, update the JSON schema in
  `packages/shared` and the registry seed in `packages/contracts`.
