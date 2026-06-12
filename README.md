# @verifiabl/node

Official Node.js SDK for [Verifiabl](https://verifiabl.io) payslip verification.

Verifiabl lets payroll providers issue payslips with a scannable verification code. The non-PII payslip data is registered with the Verifiabl API; the employee's PII is encrypted **on your infrastructure** and embedded only in the barcode on the document. It is never stored by Verifiabl.

This SDK gives you everything needed to integrate:

- **`createQrBadgeSvg`**: branded "Secured by Verifiabl" QR badge as dependency-free SVG (PNG optional)
- **`formatPii`**: formats employee PII into Verifiabl's compact barcode payload format
- **`encryptPii`**: AES-256-GCM encryption producing exactly the ciphertext and metadata the API expects
- **`VerifiablClient`**: typed, zero-dependency API client using native `fetch`

Requires Node.js 20+.

```bash
npm install @verifiabl/node
```

## Environments

Verifiabl runs registration and verification as separate services on separate domains. The client routes each call automatically:

| | Registration (issuer) | Verification (verifier) |
|---|---|---|
| `production` (default) | `register.verifiabl.io` | `verify.verifiabl.io` |
| `sandbox` | `register.sandbox.verifiabl.io` | `verify.sandbox.verifiabl.io` |

```ts
const client = new VerifiablClient({ apiKey, environment: "sandbox" });
```

`issuerBaseUrl` / `verifierBaseUrl` override individual origins (e.g. for local development).

## Quick start (self-managed flow)

```ts
import {
  VerifiablClient,
  formatPii,
  encryptPii,
  createQrBadgeSvg,
} from "@verifiabl/node";

const apiKey = process.env.VERIFIABL_API_KEY;
const encryptionKeyBase64 = process.env.VERIFIABL_ENCRYPTION_KEY_BASE64;
// Your key version, assigned by Verifiabl during onboarding — see "Key versions" below
const keyVersion = process.env.VERIFIABL_KEY_VERSION;

if (!apiKey || !encryptionKeyBase64 || !keyVersion) {
  throw new Error("Missing Verifiabl credentials");
}

const client = new VerifiablClient({
  apiKey,
});

// 1. Format the employee PII into Verifiabl's compact plaintext format
const formattedPii = formatPii({
  employee_name: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "Jane A Doe",
});
// => "P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe"

// 2. Encrypt it with your key (32 bytes, from your KMS or secrets manager)
const providerKey = Buffer.from(encryptionKeyBase64, "base64");
const { encrypted_pii, encryption_metadata } = encryptPii(formattedPii, providerKey, keyVersion);

// 3. Register the non-PII payslip data and decryption metadata
const { linking_token } = await client.registerNonPii({
  schema: "au.payslip.v1",
  issued_at: new Date().toISOString(), // must be UTC ("Z"); offsets are rejected
  payslip_data: {
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    // ...your non-PII payslip fields
  },
  encryption_metadata,
});

// 4. Render the branded QR badge and embed it in your payslip PDF
const { svg } = createQrBadgeSvg({
  linkingToken: linking_token,
  encryptedPii: encrypted_pii,
});
```

The QR code encodes `https://verify.verifiabl.io/v/<payload>`: lenders' scanning integrations verify it against the Verifiabl API, while a casual phone scan lands on a friendly explainer page. For sandbox documents pass `baseUrl: "https://verify.sandbox.verifiabl.io"` so the printed URL matches the environment the record was registered in — the URL cannot be changed after the document is issued.

## Key versions

`encryptPii` takes a `keyVersion` so Verifiabl can select the matching key at verification time. Use the value assigned during onboarding: `<provider-id>.<n>`, where `provider-id` is your client UUID and `n` starts at `1` and increments each time you rotate your encryption key (e.g. `"0f8fad5b-d9cb-469f-a165-70867728950e.1"`). Verification fails closed on unknown key versions, so records registered with a made-up version cannot be verified later.

## Styled QR options

```ts
const { svg, width, height, content } = createQrBadgeSvg(parts, {
  width: 720,                  // badge width (default 360)
  frame: false,                // bare styled QR, no card/header
  encode: "payload",           // encode bare "1|lt|ct" instead of the scan URL
  errorCorrectionLevel: "Q",   // L | M (default) | Q | H
  baseUrl: "https://verify.sandbox.verifiabl.io",
  headerText: "Secured by",
  colors: { navy: "#0B1547", panel: "#FFFFFF", text: "#FFFFFF" }, // safe SVG colours
  logoSvg: "<g>...</g>",       // replace the built-in header artwork
});
```

Rendered badges reserve the ISO/IEC 18004 quiet zone (4 modules) around the symbol, so they stay scannable after print and recapture.

### PNG output

SVG is recommended (smaller, scales perfectly in PDFs). If your pipeline needs a bitmap, install the optional rasteriser and use:

```bash
npm install @resvg/resvg-js
```

```ts
import { createQrBadgePng } from "@verifiabl/node";

const { png } = await createQrBadgePng(parts, {}, 720); // 720px wide PNG buffer
```

## API client

All three endpoints are fully typed:

```ts
await client.registerNonPii(request);          // self-managed flow: { id, linking_token }
await client.createBarcode(request);           // API-managed flow: { id, barcode }
await client.verifyBarcode({ barcode: "1|..." }); // lender-side verification
```

`verifyBarcode({ barcode })` accepts the full QR scan URL, the bare `1|...` payload, or any other format the API supports — scan URLs are unwrapped locally, everything else is passed through as scanned.

Errors throw `VerifiablApiError` with a stable `code` to match on:

```ts
import { VerifiablApiError } from "@verifiabl/node";

try {
  await client.verifyBarcode({ barcode: scanned });
} catch (err) {
  if (err instanceof VerifiablApiError && err.code === "LINKING_TOKEN_NOT_FOUND") {
    // not a Verifiabl-issued document
  }
}
```

`code` is typed as the known codes plus `string`: the API may add codes over time and they flow through unchanged, so handle unrecognised codes as generic failures rather than exhaustively matching.

Request validation is strict (unknown fields are rejected locally before any network call); response parsing is tolerant (fields added by future API releases are ignored), so an additive API change never breaks a pinned SDK version.

## Security model

- **PII never leaves your infrastructure in plaintext.** The formatted PII string is encrypted locally with your key; Verifiabl stores only non-PII data plus the IV/tag/key-version needed to verify later.
- **Keep your encryption key in a KMS or secrets manager.** Never commit it, log it, or send it anywhere. The same applies to the formatted PII plaintext: hold it in memory only. Never write it to logs or disk.
- **API keys are personal to your organisation.** Load them from a secrets manager or environment variable.
- All SDK inputs are validated with strict allow-lists (Zod) before use.

## Verifying scannability

The test suite rasterises rendered badges and decodes them with an independent QR reader, so styling can never silently break machine readability. Run it with `npm test`.

## License

[MIT](./LICENSE)
