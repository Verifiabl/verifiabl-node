# AGENTS.md — Verifiabl Node SDK

Published issuer/provider-side SDK for Verifiabl (barcode build + wire contracts). Strictly
provider-side: no verifier client and no reader-side/internal helpers. Wire contracts mirror the
monorepo and must be kept in lockstep.

## Environment

- **Node.js 20+** (`engines: node >=20`).
- Package manager: **npm** with a committed `package-lock.json`.

Install dependencies in the Codex **setup script**:

```bash
npm ci
```

## Review gates (run these; no network required)

```bash
npm run lint         # Biome lint
npm run typecheck    # tsc --noEmit
npm test             # Jest
```

Optionally `npm run build` (tsup) to confirm the published bundle compiles.
