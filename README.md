# verifiabl

Official Node.js SDK for issuing Verifiabl payslip QR codes.

Verifiabl lets payroll providers issue payslips with a scannable QR code. The non-PII payslip data is registered with the Verifiabl API; the employee's PII is encrypted **on your infrastructure** and embedded only in the barcode on the document. It is never stored by Verifiabl.

This SDK gives you everything needed to integrate:

- **`createBarcodeSvg`**: branded "Secured by Verifiabl" barcode as dependency-free SVG
- **`createBarcodePng`**: optional PNG rasterisation using `@resvg/resvg-js`
- **`formatPii`**: formats employee PII into Verifiabl's compact barcode payload format
- **`encryptPii`**: AES-256-GCM encryption producing exactly the ciphertext and metadata the API expects
- **`VerifiablClient`**: typed, zero-dependency API client using native `fetch`

Requires Node.js 20+.

```bash
npm install verifiabl
```

## Environments

Use `environment` to select production or sandbox. The SDK chooses the right Verifiabl origin automatically:

| | Issuer API | QR scan URL |
|---|---|---|
| `production` (default) | `register.verifiabl.io` | `verify.verifiabl.io` |
| `sandbox` | `register.sandbox.verifiabl.io` | `verify.sandbox.verifiabl.io` |

```ts
const client = new VerifiablClient({ auth, environment: "sandbox" });
```

Most integrations only need `environment`. `issuerBaseUrl` is an advanced local-development override for custom issuer API stacks.

## Authentication

Deployed Verifiabl environments use OAuth2 client credentials. Pass the client id and secret issued during onboarding. The SDK fetches, caches, and refreshes issuer access tokens automatically:

```ts
const client = new VerifiablClient({
  environment: "sandbox",
  auth: {
    clientId: process.env.VERIFIABL_CLIENT_ID,
    clientSecret: process.env.VERIFIABL_CLIENT_SECRET, // from your secrets manager
  },
});
```

Tokens come from the environment's auth service (`auth.verifiabl.io` / `auth.sandbox.verifiabl.io`); a stale token is refreshed and the request retried once on 401. Token failures throw `VerifiablAuthError`. For local development against a stack that accepts a fixed bearer token, use `auth: { apiKey }` instead.

## Quick start (self-managed flow)

```ts
import {
  VerifiablClient,
  formatPii,
  encryptPii,
  createBarcodeSvg,
} from "verifiabl";

const clientId = process.env.VERIFIABL_CLIENT_ID;
const clientSecret = process.env.VERIFIABL_CLIENT_SECRET;
const encryptionKeyBase64 = process.env.VERIFIABL_ENCRYPTION_KEY_BASE64;
// Your key version, assigned by Verifiabl during onboarding. See "Key versions & tamper-binding".
const keyVersion = process.env.VERIFIABL_KEY_VERSION;
const environment = "sandbox";
// The payslip schema this record is registered under. It is authenticated
// into the ciphertext, so define it once and use it in both calls below.
const schema = "au.payslip.v1";

if (!clientId || !clientSecret || !encryptionKeyBase64 || !keyVersion) {
  throw new Error("Missing Verifiabl credentials");
}

const client = new VerifiablClient({
  environment,
  auth: { clientId, clientSecret },
});

// 1. Format the employee PII into Verifiabl's compact plaintext format
const formattedPii = formatPii({
  employee_name: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "Jane A Doe",
});
// => "P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe"

// 2. Encrypt it with your key (32 bytes, from your KMS or secrets manager).
//    The key version and schema are bound into the ciphertext (AAD).
const providerKey = Buffer.from(encryptionKeyBase64, "base64");
const { encrypted_pii, encryption_metadata } = encryptPii(
  formattedPii,
  providerKey,
  keyVersion,
  schema,
);

// 3. Register the non-PII payslip data and decryption metadata
const { linking_token } = await client.registerNonPii({
  schema,
  issued_at: new Date().toISOString(), // must be UTC ("Z"); offsets are rejected
  payslip_data: {
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    // ...your non-PII payslip fields
  },
  encryption_metadata,
});

// 4. Render the branded QR badge and embed it in your payslip PDF
const { svg } = createBarcodeSvg(
  {
    linkingToken: linking_token,
    encryptedPii: encrypted_pii,
  },
  { environment },
);
```

The QR code encodes `https://verify.verifiabl.io/v/<payload>` in production and `https://verify.sandbox.verifiabl.io/v/<payload>` in sandbox. A scan is sent to Verifiabl instead of showing raw ciphertext in a phone camera preview. Pass the same `environment` to the client and barcode renderer so the printed URL matches the environment the record was registered in. The URL cannot be changed after the document is issued.

## Key versions & tamper-binding

`encryptPii` takes a `keyVersion` so Verifiabl can select the matching key when the payslip is scanned. Use the value assigned during onboarding: `<provider-id>.<n>`, where `provider-id` is your client UUID and `n` starts at `1` and increments each time you rotate your encryption key (e.g. `"0f8fad5b-d9cb-469f-a165-70867728950e.1"`). Unknown key versions fail closed, so records registered with a made-up version cannot be validated later.

The ciphertext is additionally bound (via AES-GCM AAD) to `<provider-id>|<key_version>|<schema>`. Verifiabl reconstructs this from the registered record, so a ciphertext cannot be replayed against a different provider, key version, or schema. The practical rules: the `keyVersion` and `schema` you pass to `encryptPii` must exactly match the `encryption_metadata.key_version` and `schema` fields you register, and `buildPiiAad(keyVersion, schema)` is exported if you want to reproduce server-side decryption in your own round-trip tests.

## Barcode output

```ts
const parts = { linkingToken: linking_token, encryptedPii: encrypted_pii };

const { svg, width, height, content, errorCorrectionLevel, modulePx, degraded } =
  createBarcodeSvg(parts, {
    width: 720,             // badge width, default 480 (also the minimum)
    environment: "sandbox", // production (default) | sandbox
  });
```

The SVG always uses the approved branded "Secured by Verifiabl" frame. Layout, colours, quiet zone, and QR placement are intentionally not configurable, so the badge remains consistent across customer documents. `width` only scales the complete badge uniformly and must be at least `480`. The returned `height` is always `width * 151 / 96`. **The frame's outer dimensions never change** to accommodate the payload.

The frame uses a fixed `viewBox="0 0 96 151"`. The header is navy `#010A4F`, the border is `#ADADAD`, the body is white `#FFFFFF` (with transparent rounded corners), and QR modules are black for maximum scanner contrast. The QR box is fixed at `x=8`, `y=59`, `width=80`, `height=80`. The QR matrix is sized inside that box, so payload length changes module size but never moves the frame or QR placement.

### Scannability and the degradation ladder

QR module size shrinks as the encrypted PII grows. Because the frame size is fixed, `createBarcodeSvg` keeps every emitted code scannable using a **damage-first ladder** that adjusts only the QR, never the frame:

1. **Q error correction** (~25% damage recovery) while modules stay at the ideal size. This is the pristine tier, and essentially all real payslip records land here.
2. For unusually long PII, error correction steps down `Q → M → L` (recovery `~25% → ~15% → ~7%`) to keep the code within the fixed frame. The decoded URL is identical at every level; error correction is invisible to the scan service.
3. If the PII is so long that even level `L` would render modules below the readable floor, `createBarcodeSvg` **throws** rather than emit an unscannable code. Shorten the PII fields.

The result reports what happened, so you can monitor the long tail at scale:

- `errorCorrectionLevel`: `"Q"` | `"M"` | `"L"`, the level actually used.
- `modulePx`: rendered size of one QR module, in output pixels.
- `degraded`: `true` when the ladder traded robustness to fit the payload (below `Q`, or below the ideal module size). `false` for essentially all real records. Log this to spot integrations that are pushing oversized PII.

`scanBaseUrl` is available as an advanced override for local development against a custom scan URL origin. Most integrations should use `environment` instead:

```ts
const { svg } = createBarcodeSvg(parts, {
  environment: "sandbox",
  scanBaseUrl: "https://verify.sandbox.verifiabl.io",
});
```

### Placement rules

When embedding the barcode in a payslip document:

- Preserve the returned aspect ratio. Do not set width and height independently.
- The badge paints its own white body, so the QR and its quiet zone stay readable on any document background. Only the rounded frame corners are transparent.
- Do not crop, mask, rotate, skew, stretch, recolour, or add effects.
- Do not compress or resample PNG output after generation.
- For SVG, embed the returned SVG as-is. Do not rewrite path, rect, fill, stroke, or viewBox attributes.
- Print at sufficient physical size for your document workflow. The SDK enforces a minimum digital width, but print DPI, PDF rasterisation, paper quality, and scanner camera quality still affect readability.

### PNG output

SVG is recommended (smaller, scales perfectly in PDFs). If your pipeline needs a bitmap, install the optional rasteriser and use:

```bash
npm install @resvg/resvg-js
```

```ts
import { createBarcodePng } from "verifiabl";

const { png } = await createBarcodePng(parts, {}, 720); // 720px wide PNG buffer
```

`png` is a `Buffer` containing PNG bytes. PNG output width must be at least `480` pixels.

## API client

Both issuer API methods are fully typed:

```ts
await client.registerNonPii(request); // self-managed flow: { id, linking_token }
await client.createBarcode(request);  // API-managed flow: { id, barcode }
```

Each API method accepts optional per-request controls:

```ts
const abortController = new AbortController();

const result = await client.registerNonPii(
  request,
  { timeoutMs: 10_000, signal: abortController.signal },
);
```

Errors throw `VerifiablApiError` with a stable `code` to match on:

```ts
import { VerifiablApiError } from "verifiabl";

try {
  await client.registerNonPii(request);
} catch (err) {
  if (err instanceof VerifiablApiError && err.code === "VALIDATION_FAILED") {
    console.log(err.requestId); // useful when contacting Verifiabl support
  }
}
```

`code` is typed as the known codes plus `string`: the API may add codes over time and they flow through unchanged, so handle unrecognised codes as generic failures rather than exhaustively matching.

Request validation is strict (unknown fields are rejected locally before any network call); response parsing is tolerant (fields added by future API releases are ignored), so an additive API change never breaks a pinned SDK version.

### Observability

Pass hooks when constructing the client to observe API traffic without exposing request or response bodies:

```ts
const client = new VerifiablClient({
  auth,
  onRequest: ({ method, path }) => logger.info({ method, path }, "Verifiabl request"),
  onResponse: ({ method, path, status, requestId, elapsedMs }) => {
    logger.info({ method, path, status, requestId, elapsedMs }, "Verifiabl response");
  },
  onError: ({ method, path, elapsedMs, error }) => {
    logger.error({ method, path, elapsedMs, error }, "Verifiabl request failed");
  },
});
```

`onError` is emitted when an issuer API request fails before a response is received. Hooks are best-effort observability. If a hook throws, the SDK still completes the API request.

### TypeScript

The package exports request and response types for integration code:

```ts
import type { CreateBarcodeResponse, RegisterNonPiiRequest } from "verifiabl";

const request: RegisterNonPiiRequest = {
  schema: "au.payslip.v1",
  issued_at: new Date().toISOString(),
  payslip_data: { period_start: "2026-05-01", period_end: "2026-05-31" },
  encryption_metadata,
};

const response: CreateBarcodeResponse = await client.createBarcode({
  ...request,
  encrypted_pii,
});
```

## Security model

- **PII never leaves your infrastructure in plaintext.** The formatted PII string is encrypted locally with your key; Verifiabl stores only non-PII data plus the IV/tag/key-version needed to verify later.
- **Keep your encryption key in a KMS or secrets manager.** Never commit it, log it, or send it anywhere. The same applies to the formatted PII plaintext: hold it in memory only. Never write it to logs or disk.
- **OAuth client secrets are personal to your organisation.** Load them from a secrets manager or environment variable.
- All SDK inputs are validated with strict allow-lists (Zod) before use.

## Scannability tests

The test suite rasterises rendered badges and decodes them with an independent QR reader, so styling can never silently break machine readability. Run it with `npm test`.

## License

[MIT](./LICENSE)
