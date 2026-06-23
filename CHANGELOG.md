# Changelog

All notable changes to the `verifiabl` SDK are documented here.

This project adheres to [Semantic Versioning](https://semver.org/). While the
SDK is pre-1.0, a minor version bump signals a breaking change.

## 0.8.0

### Breaking

- Renamed the "linking token" concept to **Verifiabl ID** across the entire
  public surface. This is the opaque identifier embedded in the barcode and
  presented at verification time.
  - `BarcodeParts.linkingToken` is now `BarcodeParts.verifiablId`
    (`buildBarcodePayload`, `buildScanUrl`, `createBarcodePng`, `createBarcodeSvg`).
  - `linkingTokenSchema` is now `verifiablIdSchema`.
  - `client.registerNonPii()` now resolves to `{ verifiablId }` instead of
    `{ id, linkingToken }`. The internal record UUID (`id`) is no longer
    returned; the Verifiabl ID is the only identifier the API hands back.
  - The wire field on the registration response is `verifiabl_id` (was
    `linking_token`).
- The positional barcode payload is unchanged on the wire: it remains
  `1|<value>|<value>` with the `1` format-version prefix, so existing decoders
  keep working. Only the names and docs around the first position changed.

### Migration

- Replace `linkingToken` with `verifiablId` wherever you destructure the
  registration response or build barcode parts.
- If you read the registration response's `id`, note it is gone; use
  `verifiablId` as the record's identifier.
