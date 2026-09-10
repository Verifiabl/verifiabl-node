# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.23.0]

### Changed

- P2 PII text validation now follows the versioned Unicode 17.0 profile: it
  rejects Cc, Cf, Zl, and Zp characters, limits newly written complete plaintext
  to 1024 UTF-8 bytes, accepts legacy oversized P2 plaintext when reading, and
  shares conformance vectors with the .NET SDK and verifier.
