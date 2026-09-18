# Self-managed issuer example (Node.js)

This executable example prepares two fictional payslips, exercises single and batch registration in sandbox live mode, and generates matching self-managed SVG barcodes and PDF XMP payloads. It follows the same flow as the .NET example.

## Setup

Requires Node.js 20 or later. From this directory:

```sh
pnpm install --ignore-workspace
pnpm add --ignore-workspace @verifiabl/issuer
```

## Run offline

Offline mode uses an ephemeral in-memory encryption key, makes no network requests, and writes example artifacts under `output/`:

```sh
pnpm start -- offline
```

## Run against the sandbox

Export the sandbox credentials and provider encryption key issued during onboarding. The encryption key must be a canonical Base64-encoded 32-byte key.

```sh
export VERIFIABL_CLIENT_ID='your-sandbox-client-id'
export VERIFIABL_CLIENT_SECRET='your-sandbox-client-secret'
export VERIFIABL_ENCRYPTION_KEY_BASE64='your-base64-encoded-provider-key'
pnpm start -- live
```

Each run uses a unique output directory. It writes SVG badges, matching v2 XMP payloads, registration manifests, and batch outcomes. Each manifest contains the fixed request fields needed to retry an ambiguous registration result with the same Verifiabl reference. The IV and authentication tag use Base64 in the manifest. Plaintext employee PII and the provider encryption key must remain inside the issuer's trusted infrastructure.

## Documentation snippets

Named `snippet:start` and `snippet:end` regions in `src/app.ts` are the source of the Node examples displayed in the customer documentation. The checked-in `generated/snippets.json` catalogue is managed as part of the SDK release process. Do not edit it directly. To propose a snippet change, update the executable region in a contribution; the SDK maintainers will regenerate and validate the catalogue before release.

Repository CI installs the packed SDK into a copy of this example, compiles it, and runs it offline, so the complete example is checked as a package consumer without making a sandbox request.
