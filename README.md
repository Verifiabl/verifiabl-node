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

For new AU/NZ v2 integrations, prepare the payslip once, register its non-PII fields, then build the barcode locally. You need your OAuth client ID, client secret, and encryption key from onboarding. Use the same prepared result for the request and barcode.

```ts
import { VerifiablClient, createBarcodeSvg, prepareAustralianV2Payslip } from "@verifiabl/issuer";

const client = new VerifiablClient({
  environment: "sandbox",
  auth: {
    clientId: process.env.VERIFIABL_CLIENT_ID!,
    clientSecret: process.env.VERIFIABL_CLIENT_SECRET!,
  },
});

// Your 32-byte key, from onboarding. Load it from a secrets manager.
const key = Buffer.from(process.env.VERIFIABL_ENCRYPTION_KEY_BASE64!, "base64");

// 1. Select AU2 and au.payslip.v2, validate non-PII fields, and encrypt locally.
const prepared = prepareAustralianV2Payslip({
  pii: {
    employeeName: "Jane A. Doe",
    employerName: "Example Payroll Pty Ltd",
    employerAbn: "12 345 678 901",
    address: { lines: ["12 Example St"], suburb: "Sydney", stateOrTerritory: "NSW", postcode: "2000" },
  },
  payslipNonPii: {
    periodEnd: "2026-05-31",
    paymentDate: "2026-06-04",
    currency: "AUD",
    gross: "9000.00",
    paygw: "2250.00",
    net: "6750.00",
  },
  issuedAt: new Date().toISOString(),
  key,
});

// 2. Persist the reference, registration, and barcode ciphertext together before sending.
// Store the ciphertext as binary; the registration contains only the IV and tag.
const savedRegistration = prepared.registration;
const savedCiphertext = prepared.barcodeParts(prepared.verifiablReference).encryptedPii;
// Persist { registration: savedRegistration, encryptedPii: savedCiphertext } atomically.
// After a restart, resend savedRegistration unchanged and render from savedCiphertext.
const result = await client.registerNonPii(savedRegistration);

// 3. Render from the saved ciphertext and the reference returned by the API.
const { svg } = createBarcodeSvg(
  { verifiablReference: result.verifiablReference, encryptedPii: savedCiphertext },
  { environment: "sandbox" },
);
```

### AU2 and NZ2 payslip profiles

Use `prepareAustralianV2Payslip` as shown above or `prepareNewZealandV2Payslip`
for NZ. Each selects the matching schema and PII formatter internally. The AU2
formatter accepts employer name and ABN separately, then writes the ABN when
present or falls back to the name. Structured address components collapse into
the profile's single address display field. For an API-rendered PNG, pass
`prepared.apiManagedRegistration` to `client.registerAndBuildBarcode` instead
of calling `registerNonPii`. Choose one flow per payslip. The API-managed
request omits the prepared self-managed reference; it cannot safely replay an
ambiguous failure.

```ts
import { prepareNewZealandV2Payslip } from "@verifiabl/issuer";

const nzPrepared = prepareNewZealandV2Payslip({
  pii: { employeeName: "Zoë Nguyễn", irdNumber: "***-***-***", employerName: "Example NZ Ltd" },
  payslipNonPii: {
    periodEnd: "2026-05-31", paymentDate: "2026-06-04", currency: "NZD",
    gross: "7600.00", paye: "1710.00", net: "5890.00",
  },
  issuedAt: new Date().toISOString(),
  key,
});
// Alternative API-managed flow. It returns a PNG and a server-generated reference.
const nzResult = await client.registerAndBuildBarcode(nzPrepared.apiManagedRegistration);
```

NZ2 carries the printed
employee IRD number, employer name, account number and account name. It has no
BSB or NZBN field.

Both formatters always write eight positions, including empty trailing fields.
AU addresses render as address lines followed by `suburb state postcode`; NZ
addresses render as address lines, optional suburb, then `city postcode`.
Country is implicit. The complete UTF-8 plaintext is limited to 1024 bytes.

The preparation helpers pair the AU2/NZ2 PII format with the matching v2
non-PII schema. Their input does not accept a schema, formatted plaintext, or
ciphertext. They do not check whether input values describe a real payslip or
whether printed non-PII strings contain personal information. Keep employee
PII out of non-PII fields. Advanced integrations can still select the schema
and formatter separately with the low-level APIs. The PII format and non-PII
schema versions are independent; legacy v1 verification remains supported.

Every AU2 and NZ2 amount, rate and quantity is a plain decimal string, for
example `"1234.56"`, `"-25.00"` or `"47.3684"`: an optional leading `-`, digits,
and an optional `.` followed by digits. The SDK checks this format before it
sends the record and sends the string exactly as given, so `"1.50"` and `"1.5"`
stay distinct. It does not accept a JavaScript number, because a number cannot
keep trailing zeros or more than about 17 significant digits. `currency` is
required and accepts a current ISO 4217 currency code (`supportedV2Currencies`).
Fund codes and codes with no minor unit, for example `XAU` or `XXX`, are not
accepted, because wages are paid in legal tender.

### Legacy P2 compatibility writer

The low-level `formatPii` helper remains available for legacy P2 integrations. New AU/NZ v2 integrations should use the preparation helpers instead:

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
for (const { prepared, result } of records) {
  const { png } = await createBarcodePng(prepared.barcodeParts(result.verifiablReference), {}, 720);
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

For self-managed v2 issuance, `prepareAustralianV2Payslip` or
`prepareNewZealandV2Payslip` creates the reference once. Persist
`prepared.registration` and `prepared.barcodeParts(prepared.verifiablReference).encryptedPii`
together before the first call (the registration includes the reference, IV and
tag, but **not** the ciphertext). Send the *same* registration after a process
restart, then render using the saved ciphertext and the returned reference. You can also
pass a previously allocated `verifiablReference` to the helper when you prepare
an issuance. Do not prepare and encrypt the record again for an idempotent
replay. An API-managed registration does not carry this reference.

The API returns `201` for the first registration and `200` for an identical
replay. Reusing a reference with different content returns a
`VerifiablApiError` with code `CONFLICT`.

## Batch registration

For pay runs, register up to 1000 records in one request with `registerNonPiiBatch`. Prepare each AU/NZ v2 record with its jurisdiction's helper first. The preparation creates its reference and encryption metadata together. Results match the order of the request (`results[i]` is the outcome of `records[i]`). One invalid record does not fail the batch. `RegisterNonPiiBatchRequest` also accepts future schemas; for those, use the low-level APIs.

```ts
import { prepareAustralianV2Payslip, prepareNewZealandV2Payslip } from "@verifiabl/issuer";

const issuedAt = new Date().toISOString();
const prepared = payslips.map((payslip) =>
  payslip.country === "AU"
    ? prepareAustralianV2Payslip({ pii: payslip.auPii, payslipNonPii: payslip.auNonPii, issuedAt, key })
    : prepareNewZealandV2Payslip({ pii: payslip.nzPii, payslipNonPii: payslip.nzNonPii, issuedAt, key }),
);
// Persist each prepared reference, registration, and ciphertext before sending.
const { results } = await client.registerNonPiiBatch({
  records: prepared.map((item, i) => ({
    ...item.registration,
    verifiablReference: item.verifiablReference,
    externalId: payslips[i].externalId,
  })),
});

results.forEach((result, i) => {
  if (result.status === "created" || result.status === "duplicate") {
    const parts = prepared[i].barcodeParts(result.verifiablReference);
    // Render this record's barcode from parts.
  } else {
    // Handle result.code; do not parse result.detail.
  }
});
```

## Executable example

[`examples/self-managed-issuer/src/prepared-v2.ts`](./examples/self-managed-issuer/src/prepared-v2.ts) shows both prepared v2 flows. The [full executable example](./examples/self-managed-issuer/) also shows advanced manual formatting and encryption. It registers one fictional payslip against the sandbox and writes its SVG barcode and matching PDF XMP payload. Repository CI installs the packed npm tarball into a copy of the example and compiles it as a package-consumer release test without making a sandbox request.

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
