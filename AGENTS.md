# Verifiabl Node SDK

## Rules

- Keep this issuer SDK provider-side. Do not add verifier clients or reader-side/internal helpers.
- Keep wire contracts compatible with the other SDKs.
- Keep this exported repository self-contained. Do not reference external development paths or tools.
- Use synthetic data. Do not log payslip values, keys or credentials.
- Regenerate profiles, fixtures, snippets and API references from source. Do not edit generated output.

## Checks

Use Node.js 26 and pnpm 12.3.4 for development. The published package supports Node.js 20+.
Test packed output on Node.js 20, 22 and 26. The build tool does not run on Node.js 20.
Run commands from this ecosystem root:

```sh
pnpm install --frozen-lockfile
pnpm check:ci
pnpm typecheck
pnpm test
node script/api-reference.mjs --check
```

Use `check:ci`, not lint alone, to check format and import order. `pnpm check` changes files.
For code or package changes, also run `pnpm build` and `pnpm check:exports`.
Report checks not run.

## Required reading

Read the relevant documents before edits.

| Task | Read |
| --- | --- |
| API, validation or wire contracts | [README](README.md) |
| Development or API reference | [Development](README.md#development), `package.json` |
| Examples | [Example guide](examples/self-managed-issuer/README.md) |
| Packages or releases | Local `.github/workflows/` files and export checks |
