# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `au.payslip.v1` fields that payslips print and the schema could not carry, all
  optional: `rateMicros` on an earnings line and `ordinaryRateMicros` on
  `hourly`, in millionths of a currency unit, for a rate finer than a cent
  ($65.2673 is `65267300`); `award` (FWC code plus the pay-database
  classification identifier) and `industrialInstrument`; `ytdAmountCents` on
  earnings, deduction, salary-sacrifice and superannuation lines; and
  `rateBasisPoints` on a superannuation line. A line carries `rateCents` or
  `rateMicros` and never both, and `hourly` carries exactly one of the two.

### Changed

- `ytdGrossCents` and `ytdPaygwCents` are now optional, because a payslip need
  not print a year-to-date total. A payload that sends them is unaffected.

## [0.23.0]

### Changed

- P2 PII text validation now follows the versioned Unicode 17.0 profile: it
  rejects Cc, Cf, Zl, and Zp characters, limits newly written complete plaintext
  to 1024 UTF-8 bytes, accepts legacy oversized P2 plaintext when reading, and
  shares conformance vectors with the .NET SDK and verifier.
