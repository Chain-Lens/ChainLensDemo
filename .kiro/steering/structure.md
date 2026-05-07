---
inclusion: always
---

# Repository structure

Monorepo managed by pnpm workspaces. All packages are scoped under
`@chain-lens/*`.

```
ChainLens/
├── docker/                       # Dockerfile.backend, Dockerfile.frontend, entrypoints
├── docker-compose.yml            # local postgres + services
├── docs/                         # RFCs, buyer guide, demo, policy docs
├── packages/
│   ├── backend/                  # Express gateway (Prisma, viem, Ajv, pino)
│   │   ├── prisma/               # schema.prisma, seed.ts
│   │   └── src/
│   │       ├── app.ts            # express app factory
│   │       ├── config/           # env, prisma client, viem clients
│   │       ├── middleware/       # auth, validate, error-handler
│   │       ├── repositories/     # data access (listing, ...)
│   │       ├── routes/           # market, seller, x402, admin, v1, health
│   │       ├── services/         # gateway logic, market listener, call log, injection filter
│   │       └── scripts/          # rollup-call-logs, etc.
│   ├── contracts/                # Hardhat, Ignition, OZ v5
│   ├── frontend/                 # Next.js 15 app (marketplace + evidence)
│   ├── shared/                   # ABIs, addresses, task-type schemas, chain config
│   ├── mcp-tool/                 # MCP stdio server (discover/inspect/status/call/request)
│   ├── sdk/                      # TS SDK for buyers
│   ├── sign/                     # x402 authorization signing helpers
│   ├── cli/                      # CLI entry points
│   └── sample-sellers/           # reference seller wrappers + Dockerfiles (if present)
├── TYPE2_MVP_CLEAN_BUILD_SPEC.md # authoritative MVP spec
├── AGENT_API.md                  # gateway API reference
└── PROGRESS.md                   # day-by-day build log
```

## Conventions

- **Filenames:** `kebab-case.ts` with a type suffix for layer
  (`*.service.ts`, `*.repository.ts`, `*.routes.ts`, `*.middleware.ts`).
- **Tests:** colocated `*.test.ts` next to the unit under test;
  `*.integration.test.ts` for flows that hit a DB or chain.
- **Services vs routes:** HTTP concerns stay in `routes/`, business logic
  in `services/`, raw DB queries in `repositories/`.
- **Shared types:** anything crossing package boundaries (ABIs, task-type
  schemas, addresses) must live in `@chain-lens/shared`.
- **Env loading:** only `src/config/env.ts` reads `process.env`; the rest
  of the code imports the parsed config object.
- **Logging:** use `pino` from config, never `console.*` in backend code.

## Per-package test command

```bash
pnpm --filter @chain-lens/backend test
pnpm --filter @chain-lens/contracts test
pnpm --filter @chain-lens/mcp-tool test
```
