import { type BarcodeParts, ciphertextSchema, verifiablReferenceSchema } from "./payload.js";

/**
 * Reader-side inverse of `buildBarcodePayload` / `buildScanUrl`: recover
 * `{ verifiablReference, encryptedPii }` from scanned barcode text.
 *
 * The semantics mirror the Verifiabl API's own parsing of
 * `POST /v1/verifications/payload` exactly (same accepted formats, same host
 * allow-list, same validation), so a payload this function accepts is one the
 * API accepts. Keep the two in lockstep.
 */

/** Thrown by `parseBarcode` when the input is not a valid Verifiabl barcode. */
export class BarcodeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarcodeParseError";
  }
}

// Mirrors the API's request-size ceiling for raw barcode text.
const MAX_BARCODE_LENGTH = 11_000;

const SCAN_URL_HOSTNAME_EXACT = "verifiabl.io";
const SCAN_URL_HOSTNAME_SUFFIX = ".verifiabl.io";
const SCAN_URL_PATH_PREFIX = "/v/";

function looksLikeUrl(barcode: string): boolean {
  return /^https?:\/\//i.test(barcode);
}

/**
 * Recover the bare payload from a Verifiabl scan URL, or null if `value` is
 * not an allow-listed scan URL.
 *
 * Uses the WHATWG URL parser plus an https + verifiabl.io host allow-list, NOT
 * a regex (regex URL validation is a parser-differential footgun). Decoding is
 * local; no network request is made.
 */
function decodeScanUrlPayload(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const allowedHost = host === SCAN_URL_HOSTNAME_EXACT || host.endsWith(SCAN_URL_HOSTNAME_SUFFIX);
  if (url.protocol !== "https:" || !allowedHost || !url.pathname.startsWith(SCAN_URL_PATH_PREFIX)) {
    return null;
  }

  const encoded = url.pathname.slice(SCAN_URL_PATH_PREFIX.length);
  if (encoded.length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function isReferenceCiphertextObject(
  v: unknown,
): v is { verifiabl_reference: string; ciphertext: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).verifiabl_reference === "string" &&
    typeof (v as Record<string, unknown>).ciphertext === "string"
  );
}

/**
 * Parse the bare payload wire formats:
 *
 *   Pipe-delimited v1:  "1|<verifiablReference>|<ciphertext>"
 *   JSON v1:            '{"v":1,"verifiabl_reference":"...","ciphertext":"..."}'
 *
 * Every barcode carries the ciphertext; there is no id-only variant.
 */
function parsePayloadString(payload: string): { verifiablReference: string; ciphertext: string } {
  if (payload.startsWith("1|")) {
    const [, reference, ciphertext, ...rest] = payload.split("|");
    if (reference !== undefined && ciphertext !== undefined && rest.length === 0) {
      return { verifiablReference: reference, ciphertext };
    }
    throw new BarcodeParseError(
      "Invalid v1 barcode: expected format 1|<verifiablReference>|<ciphertext>",
    );
  }

  if (payload.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new BarcodeParseError("Barcode looks like JSON but could not be parsed");
    }
    if (isReferenceCiphertextObject(parsed)) {
      return { verifiablReference: parsed.verifiabl_reference, ciphertext: parsed.ciphertext };
    }
    throw new BarcodeParseError(
      "JSON barcode must contain verifiabl_reference and ciphertext fields",
    );
  }

  throw new BarcodeParseError("Unrecognised barcode format");
}

/**
 * Parse scanned barcode text into its parts.
 *
 * Accepts everything a Verifiabl QR can carry:
 *   - the public scan URL (`https://verify[.sandbox].verifiabl.io/v/<encoded>`),
 *     host-allowlisted to verifiabl.io over https and decoded locally
 *   - the bare pipe payload `1|<verifiablReference>|<ciphertext>`
 *   - the JSON payload form (snake_case wire keys)
 *
 * The recovered Verifiabl reference and ciphertext are validated against the
 * wire-format schemas before being returned, so the result is safe to submit
 * to `/v1/verifications/payload` or embed elsewhere.
 *
 * @throws {BarcodeParseError} when the input is not a valid Verifiabl barcode.
 */
export function parseBarcode(rawText: string): BarcodeParts {
  if (rawText.length === 0) {
    throw new BarcodeParseError("Barcode text is required");
  }
  if (rawText.length > MAX_BARCODE_LENGTH) {
    throw new BarcodeParseError("Barcode text exceeds maximum allowed length");
  }

  let payload = rawText;
  if (looksLikeUrl(rawText)) {
    const decoded = decodeScanUrlPayload(rawText);
    if (decoded === null) {
      throw new BarcodeParseError("Unrecognised barcode format");
    }
    payload = decoded;
  }

  const { verifiablReference, ciphertext } = parsePayloadString(payload);

  const referenceResult = verifiablReferenceSchema.safeParse(verifiablReference);
  if (!referenceResult.success) {
    throw new BarcodeParseError("Verifiabl reference must be exactly 22 base64url characters");
  }
  const ciphertextResult = ciphertextSchema.safeParse(ciphertext);
  if (!ciphertextResult.success) {
    throw new BarcodeParseError("Ciphertext must be base64url encoded");
  }

  return { verifiablReference: referenceResult.data, encryptedPii: ciphertextResult.data };
}
