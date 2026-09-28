# @verifiabl/issuer

Official Node.js SDK for issuing Verifiabl payslip QR codes.

Add a scannable QR code to each payslip you issue. You register the non-PII payslip data with Verifiabl and encrypt the employee's personal details on your own infrastructure, so they live only inside the QR code on the document and never reach Verifiabl.

Verifiabl is for accredited payroll providers. You receive sandbox credentials at onboarding. Full documentation is at [docs.verifiabl.io](https://docs.verifiabl.io/).

## Installation

```bash
pnpm add @verifiabl/issuer
```

Requires Node.js 20+. No native dependencies: both the SVG and PNG renderers are pure JavaScript.

## Getting started

This is the self-managed flow: register the payslip, encrypt the personal details locally, and generate the QR code yourself. You need three values from onboarding: your OAuth client ID and secret, and your encryption key.

```ts
import { VerifiablClient, createBarcodeSvg, encryptPii, formatPii } from "@verifiabl/issuer";

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

// 2. Register the non-PII data. The SDK generates and sends a Verifiabl
// reference, making its automatic retries idempotent.
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

### AU2 and NZ2 payslip profiles

Use `formatAustralianPii` with `au.payslip.v2`. The formatter accepts employer
name and ABN separately, then writes the ABN when present or falls back to the
name. Structured address components collapse into the profile's single address
display field.

```ts
import {
  createBarcodeSvg,
  encryptPii,
  formatAustralianPii,
  payslipNumber,
} from "@verifiabl/issuer";

const plaintext = formatAustralianPii({
  employeeName: "Jane A. Doe",
  employerName: "Example Payroll Pty Ltd",
  employerAbn: "12 345 678 901",
  bsb: "062-000",
  accountNumber: "****5678",
  accountName: "Jane A Doe",
  address: {
    lines: ["A204/11-17 Eve Street"],
    suburb: "Erskineville",
    stateOrTerritory: "NSW",
    postcode: "2043",
  },
});
const encrypted = encryptPii(plaintext, key);
const { verifiablReference } = await client.registerNonPii({
  schema: "au.payslip.v2",
  issuedAt: new Date().toISOString(),
  payslipNonPii: {
    // periodStart is optional on AU2 and NZ2.
    periodEnd: "2026-05-31",
    paymentDate: "2026-06-04",
    currency: "AUD",
    gross: payslipNumber("8125.00", "$8,125.00"),
    paygw: payslipNumber(2030, "$2,030.00"),
    net: payslipNumber("6095.00", "$6,095.00"),
  },
  encryptionMetadata: encrypted.encryptionMetadata,
});
const { svg } = createBarcodeSvg(
  { verifiablReference, encryptedPii: encrypted.encryptedPii },
  { environment: "sandbox" },
);
```

For `nz.payslip.v2`, use `formatNewZealandPii`. NZ2 carries the printed
employee IRD number, employer name, account number and account name. It has no
BSB or NZBN field.

Both formatters always write eight positions, including empty trailing fields.
AU addresses render as address lines followed by `suburb state postcode`; NZ
addresses render as address lines, optional suburb, then `city postcode`.
Country is implicit. The complete UTF-8 plaintext is limited to 1024 bytes.

The registration `schema` selects only the non-PII payload contract. Choose the
PII formatter separately: AU2 for Australian records or NZ2 for New Zealand
records. Today the examples use AU2 with `au.payslip.v2` and NZ2 with
`nz.payslip.v2`, but those matching `2` suffixes are not a version-coupling
rule. A future non-PII schema can still use the same jurisdictional PII format,
or the PII format can evolve without renaming the non-PII schema. The verifier
checks the PII marker against the record's jurisdiction, not the schema version;
a jurisdiction mismatch fails verification. Legacy v1 verification returns this
plaintext without parsing it.

`payslipNumber` accepts a JavaScript number or an exact decimal string and
produces the required `{ value, display? }` object. A JavaScript number has no
scale, so `payslipNumber(6000.0)` sends `"6000"`. Use a string when scale must
remain exact. Currency is optional and supports AUD, NZD, USD, GBP, EUR, CAD,
SGD, HKD, CHF or ZAR.

### Legacy P2 compatibility writer

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
P2 preserves valid Unicode without normalization. Writers limit the complete plaintext, including
framing and delimiters, to 1024 UTF-8 bytes. Readers continue to accept oversized P2 plaintext from
legacy documents. The pipe and Unicode General Categories Cc (control), Cf (format), Zl (line
separator), and Zp (paragraph separator) are rejected before encryption. Ordinary international
Unicode remains valid. A v2 QR uses uppercase, unpadded RFC 4648 Base32 and the short
`v.verifiabl.io` scan host (`v.sandbox.verifiabl.io` in sandbox), with `#2.<BASE32>` and an
explicit byte/alphanumeric segment split. Its XMP copy is the matching
`2|reference|BASE32`. The SDK reads P1 plaintext for existing-document tooling, but all issuer
writers generate only P2/v2.

Ciphertext, IV, and authentication tags are binary values. The SDK exposes all
three as `Uint8Array` instances, which you can persist directly in binary database
columns. It applies base64url or Base32 encoding only at API and barcode output
boundaries.

Prefer `createBarcodeSvg` when you can: SVG scales to any size without losing quality. Use `createBarcodePng` when your document pipeline needs a raster image; it composites the badge deterministically (no rasteriser involved), so the same record produces the byte-identical raster in every Verifiabl SDK. PNG output comes in fixed pixel widths (480, 720, 960 or 1440; the physical print size is set where you place the image in the PDF). The committed frame data is a centrally generated cross-SDK artifact; the test suite independently checks it against a fresh render of the live SVG. Verifiabl can also build the QR code for you instead of generating it locally. See the [docs](https://docs.verifiabl.io/) for both.

### Placing the badge

The badge is the navy header and the QR code on a white ground, and the QR code spans the full badge width. Keep a clear light margin of at least a tenth of the badge width on the left, the right and the bottom of the badge. That margin is the QR quiet zone. Scanners need it, and the badge does not carry it itself.

### Rendering many codes

Generate codes in a loop. Each call is independent, so a single payslip and a large pay run are both fast:

```ts
for (const { verifiablReference, encryptedPii } of records) {
  const { png } = await createBarcodePng({ verifiablReference, encryptedPii }, {}, 720);
  // embed png in this record's PDF
}
```

PNGs are lossless 8-bit palette images, the smallest encoding for the badge's low colour count.

## Retries and idempotency

Failed requests are retried automatically with exponential backoff
(`VerifiablClientOptions.maxRetries`, default 2). The Verifiabl reference is the
idempotency key, so retries are only applied where they are safe.
`registerNonPii` generates and sends a reference when one is not supplied,
allowing the SDK to retry throttling, timeouts, `5xx`, and network faults without
creating another record. Batch registration has the same retry policy because
its records also carry provider-generated references. `registerAndBuildBarcode`
lets the API assign the reference and therefore retries only `429`, which is
enforced before processing.

To correlate retries made in a separate call or after a process restart,
generate and persist a reference before registration, then pass the same value
to each call:

```ts
import { generateVerifiablReference } from "@verifiabl/issuer";

const verifiablReference = generateVerifiablReference();
// Persist `verifiablReference` with the issuance record before registering.
await client.registerNonPii({ ...request, verifiablReference });
```

The API returns `201` for the first registration and `200` for an identical
replay. Reusing a reference with different content returns a
`VerifiablApiError` with code `CONFLICT`.

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

## Executable example

[`examples/self-managed-issuer`](./examples/self-managed-issuer/) is a small executable version of the self-managed flow above. It registers one fictional payslip against the sandbox and writes its SVG barcode and matching PDF XMP payload. Repository CI installs the packed npm tarball into a copy of the example and compiles it as a package-consumer release test without making a sandbox request.

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

## Development

The published package supports Node.js 20+, but building and testing from source requires Node.js 26 and pnpm 12.3.4. The build toolchain uses tsdown, which requires Node.js 22.18 or newer. CI and releases use Node.js 26 and test the resulting package separately on every supported runtime.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm check:exports
```

### Generated API reference

The public API reference is generated from the `src/index.ts` package exports and source comments with the pinned [TypeDoc](https://typedoc.org/) toolchain. Generate the deterministic catalogue with:

```sh
node script/api-reference.mjs
```

The command replaces `generated/api/node.json`. The catalogue is checked in so the customer docs can import an exact SDK revision without running Node.js or accessing this repository at build time. The TypeDoc tooling uses its own supported TypeScript compiler under `docs/`; the SDK continues to build with the compiler pinned in the root package. CI runs the non-mutating freshness check, which can also be run directly:

```sh
node script/api-reference.mjs --check
```

## License

[MIT](./LICENSE)
