# verifiabl

Official Node.js SDK for issuing Verifiabl payslip QR codes.

Add a scannable QR code to each payslip you issue. You register the non-PII payslip data with Verifiabl and encrypt the employee's personal details on your own infrastructure, so they live only inside the QR code on the document and never reach Verifiabl.

Verifiabl is for accredited payroll providers. You receive sandbox credentials at onboarding. Full documentation is at [docs.verifiabl.io](https://docs.verifiabl.io/).

## Installation

```bash
npm install verifiabl
```

Requires Node.js 20+. The example below renders an SVG badge, which needs no extra dependencies. To render a PNG instead (slower, and it pulls in a native renderer), also install:

```bash
npm install @resvg/resvg-js
```

## Getting started

This is the self-managed flow: register the payslip, encrypt the personal details locally, and generate the QR code yourself. You need four values from onboarding: your OAuth client ID and secret, your encryption key, and your key version.

```ts
import { VerifiablClient, formatPii, encryptPii, createBarcodeSvg } from "verifiabl";

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
  employeeName: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employerAbn: "12345678901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Jane A Doe",
});
const { encryptedPii, encryptionMetadata } = encryptPii(pii, key, keyVersion);

// 2. Register the non-PII data. Verifiabl returns a Verifiabl reference.
const { verifiablReference } = await client.registerNonPii({
  schema: "au.payslip.v1",
  issuedAt: new Date().toISOString(),
  payslipNonPii: { periodStart: "2026-05-01", periodEnd: "2026-05-31" },
  encryptionMetadata,
});

// 3. Render the QR code and embed the SVG in your payslip PDF.
const { svg } = createBarcodeSvg(
  { verifiablReference, encryptedPii },
  { environment: "sandbox" },
);
```

Prefer `createBarcodeSvg` when you can: SVG scales to any size without losing quality. Use `createBarcodePng` when you need a raster PNG (it needs the `@resvg/resvg-js` renderer). Verifiabl can also build the QR code for you instead of generating it locally. See the [docs](https://docs.verifiabl.io/) for both.

### Rendering many codes

Generate codes in a loop. Each call is independent, so a single payslip and a large pay run are both fast:

```ts
for (const { verifiablReference, encryptedPii } of records) {
  const { png } = await createBarcodePng({ verifiablReference, encryptedPii }, {}, 720);
  // embed png in this record's PDF
}
```

PNGs default to truecolour. Pass `{ palette: true }` for smaller files when you embed many codes in a PDF.

## Batch registration

For pay runs, register up to 1000 records in one request with `registerNonPiiBatch`. The provider generates each Verifiabl reference up-front with `generateVerifiablReference` and includes it on each record, so the whole batch can go in one round trip. Results are returned index-aligned to the input; one bad record never fails the whole batch.

```ts
import { encryptPii, formatPii, generateVerifiablReference } from "verifiabl";

const issuedAt = new Date().toISOString();
const prepared = payslips.map((payslip) => {
  const verifiablReference = generateVerifiablReference();
  const { encryptedPii, encryptionMetadata } = encryptPii(
    formatPii(payslip.pii),
    key,
    keyVersion,
  );
  // Keep `encryptedPii` alongside the reference locally: you need both to render the barcode.
  return { verifiablReference, encryptedPii, encryptionMetadata, payslip };
});

const { results } = await client.registerNonPiiBatch({
  records: prepared.map(({ verifiablReference, encryptionMetadata, payslip }) => ({
    verifiablReference,
    schema: "au.payslip.v1",
    issuedAt,
    payslipNonPii: { periodStart: payslip.periodStart, periodEnd: payslip.periodEnd },
    encryptionMetadata,
  })),
});

for (const result of results) {
  if (result.status === "error") {
    console.error(result.verifiablReference, result.code, result.detail);
  }
}
```

## Reading scanned barcodes

For verifier integrations and tooling that consume payslips rather than issue them, the SDK ships the reader-side inverses of the barcode builders:

```ts
import { extractPayloadFromPdf, parseBarcode } from "verifiabl";

// Any scanned text a Verifiabl QR can carry: the public scan URL,
// the bare "1|<verifiablReference>|<ciphertext>" payload, or the JSON form.
const { verifiablReference, encryptedPii } = parseBarcode(scannedText);

// Failsafe: recover the same payload from the payslip PDF's XMP metadata
// when the QR itself is cropped or unscannable.
const payload = await extractPayloadFromPdf(pdfBytes);
if (payload !== null) {
  const parts = parseBarcode(payload);
}
```

`parseBarcode` applies the same format rules and verifiabl.io host allow-list as the Verifiabl API, so anything it accepts can be submitted for verification. It throws `BarcodeParseError` on invalid input. `extractPayloadFromPdf` handles uncompressed and FlateDecode-compressed metadata streams without a PDF library and returns `null` when no Verifiabl metadata is present. Decryption stays server-side; neither helper touches key material.

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

Employee PII is encrypted on your infrastructure and never reaches Verifiabl. Keep your encryption key and OAuth secret in a secrets manager. See the [security model](https://docs.verifiabl.io/architecture) for the full detail.

## Documentation

Full API reference, the alternative API flow, barcode placement rules, and the security model are at [docs.verifiabl.io](https://docs.verifiabl.io/).

## License

[MIT](./LICENSE)
