# Development

The published package supports Node.js 20+, but building and testing from source requires Node.js 26 and pnpm 12.3.4. The build toolchain uses tsdown, which requires Node.js 22.18 or newer. CI and releases use Node.js 26 and test the resulting package separately on every supported runtime.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm check:exports
```

Repository CI installs the packed npm tarball into a copy of the [executable example](examples/self-managed-issuer/) and compiles it as a package-consumer test, without a sandbox request.

## Generated API reference

The public API reference is generated from the `src/index.ts` package exports and source comments with the pinned [TypeDoc](https://typedoc.org/) toolchain. Generate the deterministic catalogue with:

```sh
node script/api-reference.mjs
```

The command replaces `generated/api/node.json`. The catalogue is checked in so the customer docs can import an exact SDK revision without running Node.js or accessing this repository at build time. The TypeDoc tooling uses its own supported TypeScript compiler under `docs/`; the SDK continues to build with the compiler pinned in the root package.

TypeDoc 0.28.20 still requires vulnerable minimatch 10. The workspace overrides only TypeDoc's minimatch to 11.0.1 for GHSA-g3hv-75wg-m249 and patches its directory traversal to use the public partial-match API instead of the removed `matchOne` method. Remove both the override and patch when TypeDoc supports patched minimatch upstream. The glob regression test and reference freshness check cover this compatibility boundary. CI runs the non-mutating freshness check, which can also be run directly:

```sh
node script/api-reference.mjs --check
```
