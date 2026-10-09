# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.31.0] - 2026-10-09

### Changed

- **Breaking:** an AU2 `lump_sum` earnings line now requires a `lumpSumType`
  from `australianLumpSumTypes`: `a_redundancy` (STP lump sum A type R),
  `a_other` (A type T), `b`, `d` or `e`. Lump sum W stays `return_to_work`, and
  lump sum U stays `paid_leave` with `unused_on_termination`. The SDK rejects a
  `lump_sum` line without one before sending. The API accepts that line for now
  and will require `lump_sum_type` before production, once every issuer is on
  an SDK release with the lump sum codes.

### Added

- Add the AU2 `etp` earnings line. It requires an `etpType` from
  `australianEtpTypes`: `redundancy` (ETP code R), `other` (O),
  `redundancy_split` (S), `other_split` (P), `death_dependant` (D),
  `death_non_dependant` (N), `death_non_dependant_split` (B) or
  `death_trustee` (T), and an `etpComponent` from `australianEtpComponents`:
  `taxable` or `tax_free`. Send the taxable and tax-free components as separate
  `etp` lines. Tax withheld from an ETP is part of `paygw`.

### Removed

- **Breaking:** removed `au.payslip.v1` registration. `registerNonPii`,
  `registerAndBuildBarcode` and `registerNonPiiBatch` no longer accept it:
  single registrations reject it before sending, and a batch record with
  `au.payslip.v1` or `nz.payslip.v1` returns an "unsupported schema" error
  result and is not sent. Removed the `PayslipNonPii` type and the
  `supportedCurrencies` list. Send `au.payslip.v2` instead, for example with
  `prepareAustralianV2Payslip`; `supportedV2Currencies` lists its currencies.
- **Breaking:** removed the P2 PII writer and the P1/P2 parser: `formatPii`,
  `parsePii` and the `PiiFields` type. Verifiabl now accepts only the AU2 and
  NZ2 PII formats from issuers. Use `prepareAustralianV2Payslip` or
  `prepareNewZealandV2Payslip`, or for low-level use `formatAustralianPii` or
  `formatNewZealandPii` with `encryptPii`. Payslips already issued with P1 or
  P2 still verify.

## [0.30.0] - 2026-10-04

### Added

- Accept an `other` earnings line in AU2 and NZ2 payslips, for a pay code that
  fits no other earnings type. It takes the plain line fields and no label.

## [0.29.0] - 2026-10-04

### Added

- Accept `four_weekly` and `semi_monthly` AU2 pay frequencies.
- Add a horizontal badge layout: pass `layout: "horizontal"` to
  `createBarcodeSvg` or `createBarcodePng` to put a white gap and a
  light-tinted "Secured by Verifiabl" frame to the right of the QR code. It
  renders the QR code at the same size as the vertical badge. Its minimum SVG
  width is 940, and its PNG widths are 940, 1410, 1880 and 2820
  (`SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS`). The vertical layout remains the
  default and its output is unchanged.
- `createBarcodePng` now defaults `pixelWidth` by layout: 720 for the vertical
  layout and 1410 for the horizontal layout.

## [0.28.0] - 2026-09-30

### Changed

- Clarify that the verifier currently interprets AU2 and NZ2 as structured PII
  only for the exact `au.payslip.v2` and `nz.payslip.v2` record schemas. Future
  schema versions require a verifier reader update before issuance; the
  preparation helpers and wire format are unchanged.

## [0.27.0] - 2026-09-29

### Added

- Add `prepareAustralianV2Payslip` and `prepareNewZealandV2Payslip` to pair
  each jurisdiction's PII profile with its v2 registration schema. Prepared
  self-managed registrations carry a stable reference and independent copies
  of their request and ciphertext for safe retries and barcode rendering;
  API-managed requests omit the caller-generated reference.

### Fixed

- `formatAustralianPii` and `formatNewZealandPii` now throw `PiiValidationError`
  for forbidden text, matching `formatPii`. Violations name the input fields or
  address paths (for example `address.lines[0]`) without echoing PII values.
  Structural errors remain `ZodError`; oversized plaintext remains `RangeError`.

### Changed

- Keep the deterministic encryption helper for conformance tests internal;
  the supported `encryptPii` public API is unchanged.

## [0.26.0] - 2026-09-28

### Changed

- **Breaking:** AU2 and NZ2 amounts, rates and quantities are now plain decimal
  strings, for example `gross: "1234.56"`, instead of `{ value, display? }`
  objects. `display` is removed. The SDK checks the decimal format before it
  sends a record and sends each string exactly as given, so `"1.50"` and `"1.5"`
  stay distinct. JavaScript numbers are no longer accepted, because they cannot
  keep a value's scale.
- **Breaking:** `currency` is required on `au.payslip.v2` and `nz.payslip.v2`.
  `supportedV2Currencies` now lists the 155 current ISO 4217 currency codes
  instead of ten codes. Fund codes and codes with no minor unit (for example
  `XAU`, `XTS`, `XXX`) are excluded, because wages are paid in legal tender.
  `au.payslip.v1` is unchanged.

### Removed

- **Breaking:** removed `payslipNumber` and the `PayslipNumber` type.

## [0.25.0] - 2026-09-28

### Added

- Added closed AU2 and NZ2 non-PII schemas, registration support, numeric
  `{ value, display? }` formatting, and the optional ten-currency allow-list.
  Defined printed-string fields are allowed; integrations must not put employee PII in them.
- Added fixed-arity `formatAustralianPii` and `formatNewZealandPii` writers with
  structured address inputs and jurisdiction-specific profile identifiers.
- `periodStart` is optional for `au.payslip.v2` and `nz.payslip.v2` while
  remaining required for `au.payslip.v1`.

### Removed

- **Breaking:** removed legacy P1/v1 issuer output. `formatPiiV1`, barcode format
  options, and legacy scan-host selection are no longer available; PII and
  barcode writers now generate only P2/v2. `parsePii` still reads P1 plaintext
  from existing documents.
- **Breaking:** removed raw Base32 helpers, validation schemas, schema regexes,
  and PII-profile metadata from the package entry point. The documented URL
  constants and `parsePii` remain available for environment configuration,
  migrations, and integration tests. Use `buildBarcodePayload`, `buildScanUrl`,
  `createBarcodeSvg`, or `createBarcodePng` instead of assembling the wire
  format with `encodeBase32`. The formatting and client APIs perform their own
  validation, so integrations do not need the SDK's Zod schemas or regexes.

## [0.24.0]

### Added

- `registerNonPii` now accepts an optional provider-generated
  `verifiablReference`. When omitted, the SDK generates and sends one so
  automatic retries remain idempotent. Supply and persist a reference when
  retries must remain correlated across separate calls or process restarts.
- Issuer requests now retry automatically with exponential backoff
  (`maxRetries`, default 2), matching the .NET SDK: reference-bearing single and
  batch registration retry `429`, `408`, `5xx`, and network faults, while
  `registerAndBuildBarcode` retries only pre-processing `429` responses.

### Changed

- **Breaking:** ciphertext, AES-GCM IV, and authentication tag values are now
  exposed and accepted as `Uint8Array` instances throughout the public API. The
  SDK applies base64url encoding only when it sends issuer API requests or builds
  legacy v1 output. It applies Base32 encoding when it builds v2 barcode and XMP
  output. Integrations can now persist these values directly in binary database
  columns without decoding SDK strings.

### Removed

- **Breaking:** removed the `auth.apiKey` option. Issuer API authentication now
  requires OAuth client credentials so access tokens are refreshed automatically.

## [0.23.0]

### Changed

- P2 PII text validation now follows the versioned Unicode 17.0 profile: it
  rejects Cc, Cf, Zl, and Zp characters, limits newly written complete plaintext
  to 1024 UTF-8 bytes, accepts legacy oversized P2 plaintext when reading, and
  shares conformance vectors with the .NET SDK and verifier.
- The QR code now spans the full badge width without an internal inset, matching
  .NET issuer 0.7.0 and increasing module size. The badge carries no quiet zone
  on the left, right, or bottom; the host document must provide a clear light
  margin of at least one tenth of the badge width on those three sides.
