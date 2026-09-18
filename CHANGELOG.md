# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
