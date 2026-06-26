import { randomBytes } from "node:crypto";
import { z } from "zod";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export type VerifiablEnvironment = "production" | "sandbox";

/**
 * Verifiabl reference wire format: exactly 22 base64url characters. This is a
 * system-wide Verifiabl contract. Verifiabl references are issued by the API and must
 * be embedded verbatim.
 */
export const verifiablReferenceSchema = z
  .string()
  .length(22, "Verifiabl reference must be exactly 22 base64url characters")
  .regex(BASE64URL_RE, "Verifiabl reference must be base64url encoded");

/**
 * Generate a fresh Verifiabl reference: 16 cryptographically random bytes
 * (128 bits) encoded as 22 base64url characters without padding. Matches the
 * server's algorithm so a provider-minted reference is indistinguishable
 * from one issued by the API.
 *
 * Use this for `registerNonPiiBatch`, where providers mint their own
 * references up-front so a whole pay run can be submitted in one request.
 * Single-record `registerNonPii` does not need it; the API mints a reference
 * for you and returns it.
 */
export function generateVerifiablReference(): string {
  return randomBytes(16).toString("base64url");
}

/** Encrypted PII ciphertext: base64url, as produced by `encryptPii`. */
export const ciphertextSchema = z
  .string()
  .min(1, "Ciphertext must not be empty")
  .max(10_000, "Ciphertext exceeds maximum allowed length")
  .regex(BASE64URL_RE, "Ciphertext must be base64url encoded");

export interface BarcodeParts {
  /** Verifiabl reference returned by `client.registerNonPii`. */
  verifiablReference: string;
  /** Encrypted PII ciphertext (base64url). */
  encryptedPii: string;
}

/**
 * Default production origins used by issuing integrations.
 */
export const DEFAULT_ISSUER_BASE_URL = "https://register.verifiabl.io";
export const DEFAULT_SCAN_BASE_URL = "https://verify.verifiabl.io";

/** Sandbox origins, selected via `environment: "sandbox"` on the client. */
export const SANDBOX_ISSUER_BASE_URL = "https://register.sandbox.verifiabl.io";
export const SANDBOX_SCAN_BASE_URL = "https://verify.sandbox.verifiabl.io";

function scanBaseUrlForEnvironment(environment: VerifiablEnvironment): string {
  return environment === "sandbox" ? SANDBOX_SCAN_BASE_URL : DEFAULT_SCAN_BASE_URL;
}

/**
 * Build the v1 barcode payload: `1|<verifiablReference>|<ciphertext>`.
 *
 * This is the bare wire format. For QR codes intended to be scanned by
 * phones, prefer `buildScanUrl`, which wraps this payload in the public
 * scan-redirect URL.
 */
export function buildBarcodePayload({ verifiablReference, encryptedPii }: BarcodeParts): string {
  const id = verifiablReferenceSchema.parse(verifiablReference);
  const ciphertext = ciphertextSchema.parse(encryptedPii);
  return `1|${id}|${ciphertext}`;
}

/**
 * PDF metadata failsafe.
 *
 * Write the barcode payload (`buildBarcodePayload`) into the payslip PDF's XMP
 * metadata in addition to the QR code, so the payload is carried in two places.
 * Both hold the identical encrypted `1|verifiablReference|ciphertext` value, NEVER plaintext PII (PDF
 * metadata is not encrypted). They differ only in durability: the QR is page
 * content, while the metadata copy can be removed by re-rendering, flattening,
 * or print-to-PDF.
 *
 * Store the single payload string under the XMP property below. Write it with
 * any PDF toolchain that can set a custom XMP property; the SDK only provides
 * the keys. A verifier reads the value from either source and POSTs it to
 * `/v1/verifications/payload`.
 *
 *   XMP namespace: https://verifiabl.io/ns/   (property `payload`)
 *   value: "1|<verifiablReference>|<ciphertext>"
 *
 * The namespace is permanent: it is embedded in already-issued PDFs, so it
 * must not change.
 */
export const PDF_PAYLOAD_XMP_NAMESPACE = "https://verifiabl.io/ns/";
export const PDF_PAYLOAD_XMP_PROPERTY = "payload";

export interface ScanUrlOptions {
  /** API environment for the public QR scan URL. Defaults to "production". */
  environment?: VerifiablEnvironment;
  /**
   * Advanced override for the public QR scan URL origin. Defaults to the
   * selected environment's scan URL origin. Must use https. This URL
   * is printed on payslip documents and cannot be changed after issuance.
   */
  scanBaseUrl?: string;
}

/**
 * Build the URL encoded into Verifiabl QR codes:
 *
 *   https://verify.verifiabl.io/v/<urlencoded "1|verifiablReference|ciphertext">
 *
 * The scan URL sends scanners to Verifiabl instead of exposing raw
 * ciphertext in a phone camera preview.
 */
export function buildScanUrl(parts: BarcodeParts, options: ScanUrlOptions = {}): string {
  const environment = normaliseEnvironment(options.environment ?? "production");
  const baseUrl = normaliseScanBaseUrl(
    options.scanBaseUrl ?? scanBaseUrlForEnvironment(environment),
  );
  const payload = buildBarcodePayload(parts);
  return `${baseUrl}/v/${encodeURIComponent(payload)}`;
}

function normaliseScanBaseUrl(scanBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(scanBaseUrl);
  } catch {
    throw new Error(`Invalid scanBaseUrl: ${scanBaseUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("scanBaseUrl must use https");
  }
  return url.origin;
}

function normaliseEnvironment(environment: VerifiablEnvironment): VerifiablEnvironment {
  if (environment === "production" || environment === "sandbox") {
    return environment;
  }
  throw new Error("environment must be 'production' or 'sandbox'");
}
