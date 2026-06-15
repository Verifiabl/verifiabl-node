# Changelog

## 0.4.0 - 2026-06-16

### Breaking

- Removed AAD (AES-GCM Additional Authenticated Data) from PII encryption. Provider isolation is carried by the per-provider encryption key, and tamper detection by the GCM authentication tag, so AAD added no security.
- `encryptPii` no longer takes a `schema` argument. Its signature is now `encryptPii(pii, key, keyVersion)`. The returned `{ encrypted_pii, encryption_metadata }` shape is unchanged.
- Removed the exported `buildPiiAad` function.

### Changed

- Rewrote the README to be shorter and task-focused, pointing to docs.verifiabl.io for the full reference.
- Clarified that the provider ID embedded in `keyVersion` is distinct from the OAuth `clientId`; corrected wording that previously conflated the two.
