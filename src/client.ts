import { DEFAULT_BASE_URL, extractPayloadFromScan } from "./payload.js";
import {
  type CreatePayslipSymbolRequest,
  type CreatePayslipSymbolResponse,
  createPayslipSymbolRequestSchema,
  createPayslipSymbolResponseSchema,
  type RegisterPayslipRequest,
  type RegisterPayslipResponse,
  registerPayslipRequestSchema,
  registerPayslipResponseSchema,
  type VerifiablErrorBody,
  type VerifiablErrorCode,
  type VerifyBarcodeRequest,
  type VerifyBarcodeResponse,
  verifiablErrorBodySchema,
  verifyBarcodeRequestSchema,
  verifyBarcodeResponseSchema,
} from "./types.js";

/**
 * Error thrown for any non-2xx Verifiabl API response. Match on `code`
 * (stable) rather than `message` (may change).
 */
export class VerifiablApiError extends Error {
  readonly status: number;
  readonly code: VerifiablErrorCode;
  readonly body: VerifiablErrorBody | undefined;

  constructor(status: number, body: VerifiablErrorBody | undefined) {
    super(body?.error ?? `Verifiabl API request failed with status ${status}`);
    this.name = "VerifiablApiError";
    this.status = status;
    this.code = body?.code ?? "INTERNAL_ERROR";
    this.body = body;
  }
}

export interface VerifiablClientOptions {
  /**
   * Your Verifiabl API key. Load it from a secrets manager or environment
   * variable. Never hard-code it.
   */
  apiKey: string;
  /** API origin (default: production, https://api.verifiabl.io). Must be https. */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
  /** Custom fetch implementation (for testing or instrumentation). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Minimal typed client for the Verifiabl API. Uses native fetch with no
 * runtime HTTP dependencies. Requires Node.js 20+.
 */
export class VerifiablClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: VerifiablClientOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("apiKey is required");
    }
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (!isAllowedBaseUrl(baseUrl)) {
      throw new Error("baseUrl must use https, or http for localhost");
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive number");
    }
    if (options.fetch === undefined && globalThis.fetch === undefined) {
      throw new Error("A fetch implementation is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = baseUrl.origin;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * Register non-PII payslip data and decryption metadata. Returns the
   * linking token to embed in a locally generated barcode.
   */
  async registerPayslip(request: RegisterPayslipRequest): Promise<RegisterPayslipResponse> {
    const body = registerPayslipRequestSchema.parse(request);
    return this.post("/v1/registerNonPII", body, (value) =>
      registerPayslipResponseSchema.parse(value),
    );
  }

  /**
   * Register a payslip and have the API build the Data Matrix symbol.
   * Sends the ciphertext alongside the non-PII data.
   */
  async createPayslipSymbol(
    request: CreatePayslipSymbolRequest,
  ): Promise<CreatePayslipSymbolResponse> {
    const body = createPayslipSymbolRequestSchema.parse(request);
    return this.post("/v1/registerAndBuildSymbol", body, (value) =>
      createPayslipSymbolResponseSchema.parse(value),
    );
  }

  /**
   * Verify a scanned barcode. Accepts the raw scanned text (`{ barcode }`)
   * or pre-parsed parts (`{ lt, ct }`).
   */
  async verifyBarcode(request: VerifyBarcodeRequest): Promise<VerifyBarcodeResponse> {
    const body = normaliseVerifyBarcodeRequest(verifyBarcodeRequestSchema.parse(request));
    return this.post("/v1/verifications/payload", body, (value) =>
      verifyBarcodeResponseSchema.parse(value),
    );
  }

  private async post<T>(
    path: string,
    body: unknown,
    parseResponse: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      throw new VerifiablApiError(response.status, errorBody);
    }

    return parseResponse(await readJsonBody(response));
  }
}

function normaliseVerifyBarcodeRequest(request: VerifyBarcodeRequest): VerifyBarcodeRequest {
  if ("barcode" in request) {
    return { barcode: extractPayloadFromScan(request.barcode.trim()) };
  }
  return request;
}

function isAllowedBaseUrl(baseUrl: URL): boolean {
  if (baseUrl.protocol === "https:") {
    return true;
  }
  return baseUrl.protocol === "http:" && isLoopbackHost(baseUrl.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error(`Verifiabl API returned invalid JSON with status ${response.status}`);
  }
}

async function readErrorBody(response: Response): Promise<VerifiablErrorBody | undefined> {
  let value: unknown;
  try {
    value = await readJsonBody(response);
  } catch {
    return undefined;
  }
  const parsed = verifiablErrorBodySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
