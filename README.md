# verifiabl

Official Node.js SDK for issuing Verifiabl payslip QR codes.

Add a scannable QR code to each payslip you issue. You register the non-PII payslip data with Verifiabl and encrypt the employee's personal details on your own infrastructure, so they live only inside the QR code on the document and never reach Verifiabl.

Verifiabl is for accredited payroll providers. You receive sandbox credentials at onboarding. Full documentation is at [docs.verifiabl.io](https://docs.verifiabl.io/).

## Installation

```bash
npm install verifiabl
```

Requires Node.js 20+. The example below renders a PNG, which needs the optional renderer:

```bash
npm install @resvg/resvg-js
```

If you render SVG instead (with `createBarcodeSvg`), you don't need it.

## Getting started

This is the self-managed flow: register the payslip, encrypt the personal details locally, and generate the QR code yourself. You need four values from onboarding: your OAuth client ID and secret, your encryption key, and your key version.

```ts
import { VerifiablClient, formatPii, encryptPii, createBarcodePng } from "verifiabl";

const client = new VerifiablClient({
  environment: "sandbox",
  auth: {
    clientId: process.env.VERIFIABL_CLIENT_ID!,
    clientSecret: process.env.VERIFIABL_CLIENT_SECRET!,
  },
});

// Your 32-byte key and key version, from onboarding. Load the key from a secrets manager.
const key = Buffer.from(process.env.VERIFIABL_ENCRYPTION_KEY_BASE64!, "base64");
const keyVersion = process.env.VERIFIABL_KEY_VERSION!; // e.g. "0f8fad5b-...e.1"

// 1. Format and encrypt the employee's details locally.
const pii = formatPii({
  employee_name: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "Jane A Doe",
});
const { encrypted_pii, encryption_metadata } = encryptPii(pii, key, keyVersion);

// 2. Register the non-PII data. Verifiabl returns a linking token.
const { linking_token } = await client.registerNonPii({
  schema: "au.payslip.v1",
  issued_at: new Date().toISOString(),
  payslip_data: { period_start: "2026-05-01", period_end: "2026-05-31" },
  encryption_metadata,
});

// 3. Render the QR badge and embed the PNG in your payslip PDF.
const { png } = await createBarcodePng(
  { linkingToken: linking_token, encryptedPii: encrypted_pii },
  { environment: "sandbox" },
  720,
);
```

`createBarcodeSvg` is available if you prefer SVG. Verifiabl can also build the QR code for you instead of generating it locally. See the [docs](https://docs.verifiabl.io/) for both.

## Environments

Set `environment` to `production` (default) or `sandbox`. Pass the same value to the client and the barcode renderer, so the scan URL printed on the document matches where the record was registered.

## Errors

Failed requests throw `VerifiablApiError` with a stable `code` and a `requestId` to quote to support. Auth failures throw `VerifiablAuthError`.

```ts
import { VerifiablApiError } from "verifiabl";

try {
  await client.registerNonPii(request);
} catch (err) {
  if (err instanceof VerifiablApiError && err.code === "VALIDATION_FAILED") {
    console.log(err.requestId);
  }
}
```

## Security

Employee PII is encrypted on your infrastructure and never reaches Verifiabl. Keep your encryption key and OAuth secret in a secrets manager. See the [security model](https://docs.verifiabl.io/) for the full detail.

## Documentation

Full API reference, the alternative API flow, barcode placement rules, and the security model are at [docs.verifiabl.io](https://docs.verifiabl.io/).

## License

[MIT](./LICENSE)
