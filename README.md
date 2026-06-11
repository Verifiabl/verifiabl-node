# @verifiabl/node

Official Node.js SDK for [Verifiabl](https://verifiabl.io) payslip verification.

Verifiabl lets payroll providers issue payslips with a scannable verification code. The non-PII payslip data is registered with the Verifiabl API; the employee's PII is encrypted **on your infrastructure** and embedded only in the barcode on the document. It is never stored by Verifiabl.

This SDK gives you everything needed to integrate:

- **`createVerificationQr`**: branded "Secured by Verifiabl" QR badge as dependency-free SVG (PNG optional)
- **`formatP1`**: formats employee PII into Verifiabl's compact `P1|...` plaintext format
- **`encryptPii`**: AES-256-GCM encryption producing exactly the ciphertext and metadata the API expects
- **`VerifiablClient`**: typed, zero-dependency API client using native `fetch`

Requires Node.js 20+.

```bash
npm install @verifiabl/node
```

## Quick start (self-managed flow)

```ts
import {
  VerifiablClient,
  formatP1,
  encryptPii,
  createVerificationQr,
} from "@verifiabl/node";

const apiKey = process.env.VERIFIABL_API_KEY;
const encryptionKeyBase64 = process.env.VERIFIABL_ENCRYPTION_KEY_BASE64;

if (!apiKey || !encryptionKeyBase64) {
  throw new Error("Missing Verifiabl credentials");
}

const client = new VerifiablClient({
  apiKey,
});

// 1. Format the employee PII into the P1 plaintext format
const p1 = formatP1({
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
const { encrypted_pii, encryption_metadata } = encryptPii(p1, providerKey, "v1");

// 3. Register the non-PII payslip data and decryption metadata
const { linking_token } = await client.registerPayslip({
  schema: "au.payslip.v1",
  issued_at: new Date().toISOString(),
  payslip_data: {
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    // ...your non-PII payslip fields
  },
  encryption_metadata,
});

// 4. Render the branded QR badge and embed it in your payslip PDF
const { svg } = createVerificationQr({
  linkingToken: linking_token,
  encryptedPii: encrypted_pii,
});
```

The QR code encodes `https://api.verifiabl.io/v/<payload>`: lenders' scanning integrations verify it against the Verifiabl API, while a casual phone scan lands on a friendly explainer page.

## Styled QR options

```ts
const { svg, width, height, content } = createVerificationQr(parts, {
  width: 720,                  // badge width (default 360)
  frame: false,                // bare styled QR, no card/header
  encode: "payload",           // encode bare "1|lt|ct" instead of the scan URL
  errorCorrectionLevel: "Q",   // L | M (default) | Q | H
  baseUrl: "https://api.sandbox.verifiabl.io",
  headerText: "Secured by",
  colors: { navy: "#0B1547", panel: "#FFFFFF", text: "#FFFFFF" },
  logoSvg: "<g>...</g>",       // replace the built-in header artwork
});
```

### PNG output

SVG is recommended (smaller, scales perfectly in PDFs). If your pipeline needs a bitmap, install the optional rasteriser and use:

```bash
npm install @resvg/resvg-js
```

```ts
import { createVerificationQrPng } from "@verifiabl/node";

const { png } = await createVerificationQrPng(parts, {}, 720); // 720px wide PNG buffer
```

## API client

All three endpoints are fully typed:

```ts
await client.registerPayslip(request);          // self-managed flow: { id, linking_token }
await client.createPayslipSymbol(request);      // API-managed flow: { id, symbol }
await client.verifyBarcode({ barcode: "1|..." }); // lender-side verification
```

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

## Security model

- **PII never leaves your infrastructure in plaintext.** The P1 string is encrypted locally with your key; Verifiabl stores only non-PII data plus the IV/tag/key-version needed to verify later.
- **Keep your encryption key in a KMS or secrets manager.** Never commit it, log it, or send it anywhere. The same applies to the P1 plaintext: hold it in memory only. Never write it to logs or disk.
- **API keys are personal to your organisation.** Load them from a secrets manager or environment variable.
- All SDK inputs are validated with strict allow-lists (Zod) before use.

## Verifying scannability

The test suite rasterises rendered badges and decodes them with an independent QR reader, so styling can never silently break machine readability. Run it with `npm test`.

## License

[MIT](./LICENSE)
