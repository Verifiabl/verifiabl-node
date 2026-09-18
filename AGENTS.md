# AGENTS.md — Verifiabl Node SDK

Published issuer/provider-side SDK for Verifiabl (barcode build + wire contracts). Strictly
provider-side: no verifier client and no reader-side/internal helpers. Wire contracts must remain
compatible with the other official SDKs. Keep this repository self-contained: files must not
reference paths or development tools outside the repository root.

## Environment

- Published SDK runtime: **Node.js 20+** (`engines: node >=20`), tested from the packed output
  on Node.js 20, 22, and 26.
- Development and release toolchain: **Node.js 26**. The build requires Node.js 22.18+ because
  tsdown does not run on Node.js 20.
- Package manager: **pnpm 12.3.4** with a committed `pnpm-lock.yaml`.

Use Node.js 26 and install dependencies in the Codex **setup script**:

```bash
pnpm install --frozen-lockfile
```

## Review gates (run these; no network required)

```bash
pnpm check:ci     # Biome lint + formatting + import order, exactly as CI runs it
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest
```

`pnpm lint` is lint-only and will pass on formatting or import-order drift that
`check:ci` fails on; `pnpm check` fixes both in place.

Optionally `pnpm build` (tsdown) to confirm the published ESM and CommonJS bundles compile.
