# AGENTS.md — Verifiabl Node SDK

Published issuer/provider-side SDK for Verifiabl (barcode build + wire contracts). Strictly
provider-side: no verifier client and no reader-side/internal helpers. Wire contracts must remain
compatible with the other official SDKs. Keep this repository self-contained: files must not
reference paths or development tools outside the repository root.

## Environment

- **Node.js 20+** (`engines: node >=20`), tested on Node.js 20, 22, and 26.
- Package manager: **pnpm 12.3.4** with a committed `pnpm-lock.yaml`.

Install dependencies in the Codex **setup script**:

```bash
pnpm install --frozen-lockfile
```

## Review gates (run these; no network required)

```bash
pnpm check:ci     # Biome lint + formatting + import order, exactly as CI runs it
pnpm typecheck    # tsc --noEmit
pnpm test         # Jest
```

`pnpm lint` is lint-only and will pass on formatting or import-order drift that
`check:ci` fails on; `pnpm check` fixes both in place.

Optionally `pnpm build` (tsup) to confirm the published bundle compiles.
