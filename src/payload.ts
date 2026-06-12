import { z } from "zod";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Linking token wire format: exactly 22 base64url characters. This is a
 * system-wide Verifiabl contract. Tokens are issued by the API and must
 * be embedded verbatim.
 */
export const linkingTokenSchema = z
  .string()
  .length(22, "Linking token must be exactly 22 base64url characters")
  .regex(BASE64URL_RE, "Linking token must be base64url encoded");

/** Encrypted PII ciphertext: base64url, as produced by `encryptPii`. */
export const ciphertextSchema = z
  .string()
  .min(1, "Ciphertext must not be empty")
  .max(10_000, "Ciphertext exceeds maximum allowed length")
  .regex(BASE64URL_RE, "Ciphertext must be base64url encoded");

export interface BarcodeParts {
  /** Linking token returned by `client.registerNonPii`. */
  linkingToken: string;
  /** Encrypted PII ciphertext (base64url). */
  encryptedPii: string;
}

/**
 * Default production origins. Verifiabl runs registration and verification
 * as separately deployed services on separate domains: payslip registration
 * goes to the issuer service, barcode verification and the public QR scan
 * redirect go to the verifier service.
 */
export const DEFAULT_ISSUER_BASE_URL = "https://register.verifiabl.io";
export const DEFAULT_VERIFIER_BASE_URL = "https://verify.verifiabl.io";

/** Sandbox origins, selected via `environment: "sandbox"` on the client. */
export const SANDBOX_ISSUER_BASE_URL = "https://register.sandbox.verifiabl.io";
export const SANDBOX_VERIFIER_BASE_URL = "https://verify.sandbox.verifiabl.io";

/**
 * Build the v1 barcode payload: `1|<linkingToken>|<ciphertext>`.
 *
 * This is the bare wire format. For QR codes intended to be scanned by
 * phones, prefer `buildScanUrl`, which wraps this payload in the public
 * scan-redirect URL.
 */
export function buildBarcodePayload({ linkingToken, encryptedPii }: BarcodeParts): string {
  const lt = linkingTokenSchema.parse(linkingToken);
  const ct = ciphertextSchema.parse(encryptedPii);
  return `1|${lt}|${ct}`;
}

export interface ScanUrlOptions {
  /**
   * Verifier origin to embed in the QR code (default: production,
   * `https://verify.verifiabl.io`). The `/v/` scan-redirect route is
   * served by the verifier service, so this must be a verifier origin
   * (use `https://verify.sandbox.verifiabl.io` for sandbox). Must be
   * https. This URL is printed on payslip documents and cannot be
   * changed after issuance.
   */
  baseUrl?: string;
}

/**
 * Build the URL encoded into Verifiabl QR codes:
 *
 *   https://verify.verifiabl.io/v/<urlencoded "1|lt|ct">
 *
 * Verifier integrations strip the origin + `/v/` prefix and POST the
 * decoded payload to /v1/verifications/payload. A casual phone scan hits
 * the public redirect route and lands on the Verifiabl site instead of
 * seeing raw ciphertext.
 */
export function buildScanUrl(parts: BarcodeParts, options: ScanUrlOptions = {}): string {
  const baseUrl = normaliseBaseUrl(options.baseUrl ?? DEFAULT_VERIFIER_BASE_URL);
  const payload = buildBarcodePayload(parts);
  return `${baseUrl}/v/${encodeURIComponent(payload)}`;
}

/**
 * Extract the bare `1|lt|ct` payload from a scanned QR string. Accepts
 * either the full scan URL or an already-bare payload, so verifier-side
 * code can be agnostic about which form it received.
 */
export function extractPayloadFromScan(scanned: string): string {
  if (scanned.startsWith("1|")) {
    return scanned;
  }
  const match = scanned.match(/^https:\/\/[^/]+\/v\/(.+)$/);
  if (!match || match[1] === undefined) {
    throw new Error("Unrecognised scan format: expected '1|...' payload or https .../v/ URL");
  }
  return decodeURIComponent(match[1]);
}

function normaliseBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid baseUrl: ${baseUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("baseUrl must use https");
  }
  return url.origin;
}
