# @verifiabl/issuer

Official Node.js SDK for issuing Verifiabl payslip QR codes.

Add a scannable QR code to each payslip you issue. You register the non-PII payslip data with Verifiabl and encrypt the employee's personal details on your own infrastructure, so they live only inside the QR code on the document and never reach Verifiabl.

Verifiabl is for accredited payroll providers. You receive sandbox credentials at onboarding. Full documentation is at [docs.verifiabl.io](https://docs.verifiabl.io/).

## Installation

```bash
npm install @verifiabl/issuer
```

Requires Node.js 20+. No native dependencies: both the SVG and PNG renderers are pure JavaScript.

## Getting started

This is the self-managed flow: register the payslip, encrypt the personal details locally, and generate the QR code yourself. You need three values from onboarding: your OAuth client ID and secret, and your encryption key.

```ts
import { VerifiablClient, formatPii, encryptPii, createBarcodeSvg } from "@verifiabl/issuer";

const client = new VerifiablClient({
  environment: "sandbox",
  auth: {
    clientId: process.env.VERIFIABL_CLIENT_ID!,
    clientSecret: process.env.VERIFIABL_CLIENT_SECRET!,
  },
});

// Your 32-byte key, from onboarding. Load it from a secrets manager.
const key = Buffer.from(process.env.VERIFIABL_ENCRYPTION_KEY_BASE64!, "base64");

// 1. Format and encrypt the employee's details locally.
const pii = formatPii({
  employeeName: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employerAbn: "12345678901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Jane A Doe",
  address: "12 Example St, Sydney NSW 2000",
});
const { encryptedPii, encryptionMetadata } = encryptPii(pii, key);

// 2. Register the non-PII data. Verifiabl returns a Verifiabl reference.
const { verifiablReference } = await client.registerNonPii({
  schema: "au.payslip.v1",
  issuedAt: new Date().toISOString(),
  // Canonical au.payslip.v1: all amounts are integer cents.
  // `currency` is one of AUD, NZD, USD, GBP, EUR, CAD, SGD, HKD, CHF or ZAR: the
  // ISO 4217 codes with a minor-unit exponent of 2, so cents are really cents.
  payslipNonPii: {
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    paymentDate: "2026-06-04",
    currency: "AUD",
    grossCents: 900_000,
    paygwCents: 225_000,
    netCents: 675_000,
    ytdGrossCents: 5_400_000,
    ytdPaygwCents: 1_350_000,
  },
  encryptionMetadata,
});

// 3. Render the QR code and embed the SVG in your payslip PDF.
const { svg } = createBarcodeSvg(
  { verifiablReference, encryptedPii },
  { environment: "sandbox" },
);
```

### V2 / P2 writers

The SDK writes the current P2 plaintext and v2 barcode payload by default:

```ts
import { buildBarcodePayload, createBarcodeSvg, encryptPii, formatPii } from "@verifiabl/issuer";

const plaintext = formatPii({
  employeeName: "Zoë Nguyễn",
  position: "Ingénieure",
  address: "12 Rue de l’Église, Apt 4B, 75005 Paris, France 🇫🇷",
});
const { encryptedPii, encryptionMetadata } = encryptPii(plaintext, key);
const parts = { verifiablReference, encryptedPii };
const { svg } = createBarcodeSvg(parts, { environment: "sandbox" });
const xmpPayload = buildBarcodePayload(parts);
```

P2 is exactly `P2|employeeName|position|department|employerAbn|bsb|accountNumber|accountName|address`.
The final address is unstructured, optional, preserved verbatim, and limited to 320 UTF-8 bytes.
Pipes, control characters, and Unicode format characters are rejected before encryption. A v2 QR
uses the short `v.verifiabl.io` scan host (`v.sandbox.verifiabl.io` in sandbox) with `#2.<BASE32>` and an explicit byte/alphanumeric segment split. Its XMP
copy must be the matching `2|reference|BASE32`. Never mix QR and XMP versions. For rollback, pass
`{ format: "v1" }` to `createBarcodeSvg`, `createBarcodePng`, `buildScanUrl`, and `buildBarcodePayload`.

Prefer `createBarcodeSvg` when you can: SVG scales to any size without losing quality. Use `createBarcodePng` when your document pipeline needs a raster image; it composites the badge deterministically (no rasteriser involved), so the same record produces the byte-identical raster in every Verifiabl SDK. PNG output comes in fixed pixel widths (480, 720, 960 or 1440; the physical print size is set where you place the image in the PDF). Verifiabl can also build the QR code for you instead of generating it locally. See the [docs](https://docs.verifiabl.io/) for both.

### Rendering many codes

Generate codes in a loop. Each call is independent, so a single payslip and a large pay run are both fast:

```ts
for (const { verifiablReference, encryptedPii } of records) {
  const { png } = await createBarcodePng({ verifiablReference, encryptedPii }, {}, 720);
  // embed png in this record's PDF
}
```

PNGs are lossless 8-bit palette images, the smallest encoding for the badge's low colour count.

### Scanner test pack

Generate synthetic v2 symbols for screen, print, fold, photocopy, camera, and hardware-scanner tests:

```bash
npm run scanner:pack -- ./artifacts/ver-460
```

Open `artifacts/ver-460/index.html` for screen or print tests. The pack includes PNG files and a
`manifest.json` file. The manifest records each exact scan URL, XMP payload, ciphertext byte value,
QR version, and error-correction level. All fixture details are synthetic. Do not replace them with
customer data. CI also publishes the same pack as the `verifiabl-node-scanner-pack` workflow
artifact.

## Development shell

The pinned Nix shell supplies Node.js 22 and npm:

```bash
nix develop
npm ci
npm test
```

## Batch registration

For pay runs, register up to 1000 records in one request with `registerNonPiiBatch`. The provider generates each Verifiabl reference up-front with `generateVerifiablReference` and includes it on each record, so the whole batch can go in one round trip. Results come back in the same order as the input records (`results[i]` is the outcome of `records[i]`); one bad record never fails the whole batch.

```ts
import { encryptPii, formatPii, generateVerifiablReference } from "@verifiabl/issuer";

const issuedAt = new Date().toISOString();
const prepared = payslips.map((payslip) => {
  const verifiablReference = generateVerifiablReference();
  const { encryptedPii, encryptionMetadata } = encryptPii(formatPii(payslip.pii), key);
  // Keep `encryptedPii` alongside the reference locally: you need both to render the barcode.
  return { verifiablReference, encryptedPii, encryptionMetadata, payslip };
});

const { results } = await client.registerNonPiiBatch({
  records: prepared.map(({ verifiablReference, encryptionMetadata, payslip }) => ({
    verifiablReference,
    schema: "au.payslip.v1",
    issuedAt,
    payslipNonPii: payslip.nonPii,
    encryptionMetadata,
  })),
});

for (const result of results) {
  if (result.status === "error") {
    console.error(result.verifiablReference, result.code, result.detail);
  }
}
```

## Environments

Set `environment` to `production` (default) or `sandbox`. Pass the same value to the client and the barcode renderer, so the scan URL printed on the document matches where the record was registered.

## Errors

Failed requests throw `VerifiablApiError` with a stable `code` and a `requestId` to quote to support. Auth failures throw `VerifiablAuthError`.

```ts
import { VerifiablApiError } from "@verifiabl/issuer";

try {
  await client.registerNonPii(request);
} catch (err) {
  if (err instanceof VerifiablApiError && err.code === "VALIDATION_FAILED") {
    console.log(err.requestId);
  }
}
```

### Reused encryption IV

Registration rejects an IV that your issuer has already used. `encryptPii` draws a fresh IV on every call, so this occurs when stored `encryptionMetadata` is sent again with different content.

Single registrations throw `VerifiablIvReuseError`, a subclass of `VerifiablApiError` with the code `IV_REUSED`. Batch records come back as an error result that `isIvReuseResult` matches. In both cases, encrypt the payslip again with `encryptPii` and resend the record with the new encryption metadata. A barcode that you already rendered from the previous ciphertext must be rebuilt from the new one. Do not send the same record again without changes: the result stays the same.

```ts
import { encryptPii, VerifiablIvReuseError } from "@verifiabl/issuer";

try {
  await client.registerNonPii(request);
} catch (err) {
  if (err instanceof VerifiablIvReuseError) {
    // Encrypt again for a fresh IV and ciphertext, then register and render again.
    const { encryptedPii, encryptionMetadata } = encryptPii(pii, key);
  }
}
```

```ts
import { isIvReuseResult } from "@verifiabl/issuer";

const { results } = await client.registerNonPiiBatch({ records });
const toReEncrypt = results.filter(isIvReuseResult).map((result) => result.verifiablReference);
```

### Barcode capacity

The barcode renderers throw `QrCapacityError` when the QR code cannot hold the encrypted PII. Catch this error and shorten the PII fields. The error gives three properties. `contentLength` is the number of characters in the scan URL. `badgeWidth` is the width that you gave to the renderer. `reason` is `frame-fit` or `qr-capacity`. For `frame-fit`, a larger width can hold the same content. For `qr-capacity`, no QR code can hold the content at any width.

```ts
import { createBarcodePng, QrCapacityError } from "@verifiabl/issuer";

try {
  const { png } = await createBarcodePng({ verifiablReference, encryptedPii }, {}, 720);
} catch (err) {
  if (err instanceof QrCapacityError) {
    console.error(err.reason, err.contentLength);
  }
}
```

## Security

Employee PII is encrypted on your infrastructure and never reaches Verifiabl. Keep your encryption key and OAuth secret in a secrets manager. See the [security model](https://docs.verifiabl.io/architecture) for the full detail.

## Documentation

Full API reference, the alternative API flow, barcode placement rules, and the security model are at [docs.verifiabl.io](https://docs.verifiabl.io/).

## License

[MIT](./LICENSE)
