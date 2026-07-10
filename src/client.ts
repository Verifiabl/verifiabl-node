import { resolveEnvironment, type VerifiablEnvironment } from "./payload.js";
import {
  type RegisterAndBuildBarcodeRequest,
  type RegisterAndBuildBarcodeResponse,
  type RegisterNonPiiBatchRequest,
  type RegisterNonPiiBatchResponse,
  type RegisterNonPiiRequest,
  type RegisterNonPiiResponse,
  registerAndBuildBarcodeFromWire,
  registerAndBuildBarcodeRequestSchema,
  registerAndBuildBarcodeToWire,
  registerNonPiiBatchFromWire,
  registerNonPiiBatchRequestSchema,
  registerNonPiiBatchToWire,
  registerNonPiiRequestSchema,
  registrationFromWire,
  registrationToWire,
  type VerifiablErrorBody,
  type VerifiablErrorCode,
  verifiablErrorBodySchema,
} from "./types.js";

/**
 * Error thrown for any non-2xx Verifiabl API response. Match on `code`
 * (stable) rather than `message` (may change).
 *
 * `code` is "INTERNAL_ERROR" when the response carried no parseable
 * Verifiabl error body (e.g. a gateway error page); check `status` for
 * the raw HTTP status in that case.
 */
export class VerifiablApiError extends Error {
  readonly status: number;
  readonly code: VerifiablErrorCode;
  readonly body: VerifiablErrorBody | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: VerifiablErrorBody | undefined, requestId?: string) {
    super(body?.error ?? `Verifiabl API request failed with status ${status}`);
    this.name = "VerifiablApiError";
    this.status = status;
    this.code = body?.code ?? "INTERNAL_ERROR";
    this.body = body;
    this.requestId = requestId;
  }
}

/**
 * Error thrown when an OAuth access token cannot be obtained. `status` is
 * the HTTP status returned by the token endpoint, or undefined when the
 * request itself failed or the response was unparseable.
 */
export class VerifiablAuthError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "VerifiablAuthError";
    this.status = status;
  }
}

export type { VerifiablEnvironment } from "./payload.js";

/**
 * How the client authenticates to the Verifiabl API.
 *
 * Deployed environments use OAuth2 client credentials: pass the
 * `clientId`/`clientSecret` issued during onboarding and the client
 * fetches, caches, and refreshes access tokens automatically.
 * The static `apiKey` form sends a fixed bearer token and exists for
 * local development against a stack that accepts one.
 */
export type VerifiablAuth =
  | { apiKey: string }
  | {
      /** OAuth client id issued by Verifiabl during onboarding. */
      clientId: string;
      /** OAuth client secret. Load from a secrets manager; never hard-code it. */
      clientSecret: string;
      /**
       * OAuth token endpoint (default: the environment's auth service,
       * e.g. https://auth.verifiabl.io/oauth/token). Overrides must use a
       * Verifiabl auth host, or localhost for local development.
       */
      tokenUrl?: string;
    };

const VERIFIABL_AUTH_HOSTS = new Set(["auth.verifiabl.io", "auth.sandbox.verifiabl.io"]);

const ISSUER_SCOPE = "verifiabl:issuer";

/** Maximum time before expiry that an OAuth token is treated as stale. */
const MAX_TOKEN_REFRESH_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

interface ResolvedRequestOptions {
  timeoutMs: number;
  deadlineAtMs: number;
  signal: AbortSignalLike | undefined;
}

type AbortListener = () => void;

interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: "abort",
    listener: AbortListener,
    options?: { once?: boolean } | boolean,
  ): void;
  removeEventListener(type: "abort", listener: AbortListener): void;
}

interface RequestSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

export interface VerifiablRequestOptions {
  /** Request timeout in milliseconds. Defaults to the client's timeoutMs. */
  timeoutMs?: number;
  /** Abort signal for this request. */
  signal?: AbortSignal;
}

export interface VerifiablRequestEvent {
  method: "POST";
  url: string;
  path: string;
}

export interface VerifiablResponseEvent extends VerifiablRequestEvent {
  status: number;
  elapsedMs: number;
  requestId: string | undefined;
}

export interface VerifiablErrorEvent extends VerifiablRequestEvent {
  elapsedMs: number;
  error: unknown;
}

export interface VerifiablClientOptions {
  /** How to authenticate. See {@link VerifiablAuth}. */
  auth: VerifiablAuth;
  /** API environment. Defaults to "production". */
  environment?: VerifiablEnvironment;
  /**
   * Advanced local development override for issuer API calls
   * (`registerNonPii`, `registerNonPiiBatch`, and `registerAndBuildBarcode`). Most
   * integrations should leave this unset and use `environment` instead.
   * Must use https, except localhost may use http.
   */
  issuerBaseUrl?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
  /** Custom fetch implementation (for testing or instrumentation). */
  fetch?: typeof globalThis.fetch;
  /** Called before each Verifiabl API request. Bodies are not included. */
  onRequest?: (event: VerifiablRequestEvent) => void;
  /** Called after each Verifiabl API response. Bodies are not included. */
  onResponse?: (event: VerifiablResponseEvent) => void;
  /** Called when an issuer API request fails before receiving a response. */
  onError?: (event: VerifiablErrorEvent) => void;
}

/**
 * Minimal typed client for the Verifiabl API. Uses native fetch with no
 * runtime HTTP dependencies. Requires Node.js 20+.
 */
export class VerifiablClient {
  private readonly auth: VerifiablAuth;
  private readonly tokenUrl: string;
  private readonly issuerBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onRequest: ((event: VerifiablRequestEvent) => void) | undefined;
  private readonly onResponse: ((event: VerifiablResponseEvent) => void) | undefined;
  private readonly onError: ((event: VerifiablErrorEvent) => void) | undefined;
  private tokenCache: CachedToken | undefined;
  private tokenInFlight: Promise<CachedToken> | undefined;

  constructor(options: VerifiablClientOptions) {
    const origins = resolveEnvironment(options.environment ?? "production");
    const auth = validateAuth(options.auth);
    this.auth = auth;
    this.tokenUrl =
      "tokenUrl" in auth && auth.tokenUrl !== undefined
        ? parseTokenUrl(auth.tokenUrl)
        : origins.tokenUrl;
    this.issuerBaseUrl = parseBaseUrl(
      options.issuerBaseUrl ?? origins.issuerBaseUrl,
      "issuerBaseUrl",
    );
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive number");
    }
    if (options.fetch === undefined && globalThis.fetch === undefined) {
      throw new Error("A fetch implementation is required");
    }
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.onRequest = options.onRequest;
    this.onResponse = options.onResponse;
    this.onError = options.onError;
  }

  /**
   * Register non-PII payslip data and decryption metadata. Returns the
   * Verifiabl reference to embed in a locally generated barcode.
   */
  async registerNonPii(
    request: RegisterNonPiiRequest,
    options: VerifiablRequestOptions = {},
  ): Promise<RegisterNonPiiResponse> {
    const body = registrationToWire(registerNonPiiRequestSchema.parse(request));
    return this.post("/v1/registerNonPII", body, options, registrationFromWire);
  }

  /**
   * Register non-PII payslip data and have the API build the barcode.
   * Sends the encrypted PII alongside the non-PII data.
   */
  async registerAndBuildBarcode(
    request: RegisterAndBuildBarcodeRequest,
    options: VerifiablRequestOptions = {},
  ): Promise<RegisterAndBuildBarcodeResponse> {
    const body = registerAndBuildBarcodeToWire(registerAndBuildBarcodeRequestSchema.parse(request));
    return this.post("/v1/registerAndBuildBarcode", body, options, registerAndBuildBarcodeFromWire);
  }

  /**
   * Register a batch of non-PII payslip records in a single request, up to
   * `MAX_BATCH_RECORDS` records. Each record carries a provider-generated
   * Verifiabl reference (from `generateVerifiablReference`) and the same
   * fields as `registerNonPii`. Results come back in the same order as the
   * input records (`results[i]` is the outcome of `records[i]`); one bad record
   * never fails the batch.
   */
  async registerNonPiiBatch(
    request: RegisterNonPiiBatchRequest,
    options: VerifiablRequestOptions = {},
  ): Promise<RegisterNonPiiBatchResponse> {
    const body = registerNonPiiBatchToWire(registerNonPiiBatchRequestSchema.parse(request));
    return this.post("/v1/registerNonPIIBatch", body, options, registerNonPiiBatchFromWire);
  }

  private async post<T>(
    path: string,
    body: unknown,
    options: VerifiablRequestOptions,
    parseResponse: (value: unknown) => T,
  ): Promise<T> {
    const requestOptions = resolveRequestOptions(options, this.timeoutMs);
    let response = await this.send(path, body, requestOptions);

    if (response.status === 401 && "clientId" in this.auth) {
      // The cached token may have been revoked or expired early; fetch a
      // fresh one and retry exactly once.
      this.tokenCache = undefined;
      response = await this.send(path, body, requestOptions);
    }

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      throw new VerifiablApiError(response.status, errorBody, extractRequestId(response.headers));
    }

    return parseResponse(await readJsonBody(response));
  }

  private async send(
    path: string,
    body: unknown,
    options: ResolvedRequestOptions,
  ): Promise<Response> {
    const url = `${this.issuerBaseUrl}${path}`;
    const startedAtMs = Date.now();
    const token = await this.getBearerToken(this.issuerBaseUrl, options);
    callHook(this.onRequest, { method: "POST", url, path });
    const requestSignal = createRequestSignal(options);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal.signal,
      });
    } catch (err) {
      callHook(this.onError, {
        method: "POST",
        url,
        path,
        elapsedMs: Date.now() - startedAtMs,
        error: err,
      });
      throw err;
    } finally {
      requestSignal.cleanup();
    }
    callHook(this.onResponse, {
      method: "POST",
      url,
      path,
      status: response.status,
      elapsedMs: Date.now() - startedAtMs,
      requestId: extractRequestId(response.headers),
    });
    return response;
  }

  private async getBearerToken(audience: string, options: ResolvedRequestOptions): Promise<string> {
    if ("apiKey" in this.auth) {
      return this.auth.apiKey;
    }

    if (this.tokenCache !== undefined && isTokenReusable(this.tokenCache)) {
      return this.tokenCache.accessToken;
    }

    if (this.tokenInFlight !== undefined) {
      const token = await waitForToken(this.tokenInFlight, options);
      if (isTokenReusable(token)) {
        return token.accessToken;
      }
    }

    const tokenPromise = this.requestAccessToken(audience, options);
    this.tokenInFlight = tokenPromise;
    try {
      const token = await tokenPromise;
      this.tokenCache = token;
      return token.accessToken;
    } finally {
      this.tokenInFlight = undefined;
    }
  }

  private async requestAccessToken(
    audience: string,
    options: ResolvedRequestOptions,
  ): Promise<CachedToken> {
    if (!("clientId" in this.auth)) {
      throw new VerifiablAuthError("OAuth credentials are not configured");
    }

    let response: Response;
    const requestSignal = createRequestSignal(options);
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.auth.clientId,
          client_secret: this.auth.clientSecret,
          audience,
          scope: ISSUER_SCOPE,
        }),
        signal: requestSignal.signal,
      });
    } catch (err) {
      if (options.signal?.aborted || isAbortLikeError(err)) {
        throw err;
      }
      throw new VerifiablAuthError("Could not reach the Verifiabl OAuth token endpoint");
    } finally {
      requestSignal.cleanup();
    }

    if (!response.ok) {
      throw new VerifiablAuthError(
        `Verifiabl OAuth token request failed with status ${response.status}`,
        response.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new VerifiablAuthError("Verifiabl OAuth token response was not valid JSON");
    }

    const token = parseTokenResponse(parsed);
    if (token === undefined) {
      throw new VerifiablAuthError("Verifiabl OAuth token response had an unexpected shape");
    }

    const issuedAtMs = Date.now();
    return {
      accessToken: token.accessToken,
      issuedAtMs,
      expiresAtMs: issuedAtMs + token.expiresInSeconds * 1000,
    };
  }
}

function isTokenReusable(token: CachedToken): boolean {
  const ttlMs = token.expiresAtMs - token.issuedAtMs;
  const refreshBufferMs = Math.min(MAX_TOKEN_REFRESH_BUFFER_MS, ttlMs / 2);
  return token.expiresAtMs - Date.now() > refreshBufferMs;
}

function validateAuth(auth: VerifiablAuth): VerifiablAuth {
  if (typeof auth !== "object" || auth === null) {
    throw new Error("auth is required: pass { clientId, clientSecret } or { apiKey }");
  }

  const apiKey = objectProperty(auth, "apiKey");
  const clientId = objectProperty(auth, "clientId");
  const clientSecret = objectProperty(auth, "clientSecret");
  const tokenUrl = objectProperty(auth, "tokenUrl");
  const hasApiKey = apiKey !== undefined;
  const hasOauthField = clientId !== undefined || clientSecret !== undefined;

  if (hasApiKey && hasOauthField) {
    throw new Error("auth must use either { apiKey } or { clientId, clientSecret }, not both");
  }

  if (hasApiKey) {
    if (typeof apiKey !== "string") {
      throw new Error("auth.apiKey must be a string");
    }
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey.length === 0) {
      throw new Error("auth.apiKey must not be empty");
    }
    if (tokenUrl !== undefined) {
      throw new Error("auth.tokenUrl requires OAuth client credentials");
    }
    return { apiKey: trimmedApiKey };
  }

  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new Error(
      "auth must include { apiKey: string } or { clientId: string, clientSecret: string }",
    );
  }
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();
  if (trimmedClientId.length === 0 || trimmedClientSecret.length === 0) {
    throw new Error("auth.clientId and auth.clientSecret are required");
  }
  if (tokenUrl !== undefined && typeof tokenUrl !== "string") {
    throw new Error("auth.tokenUrl must be a string");
  }
  const trimmedTokenUrl = tokenUrl?.trim();
  if (trimmedTokenUrl !== undefined && trimmedTokenUrl.length === 0) {
    throw new Error("auth.tokenUrl must not be empty");
  }

  return trimmedTokenUrl === undefined
    ? { clientId: trimmedClientId, clientSecret: trimmedClientSecret }
    : { clientId: trimmedClientId, clientSecret: trimmedClientSecret, tokenUrl: trimmedTokenUrl };
}

function parseTokenResponse(
  value: unknown,
): { accessToken: string; expiresInSeconds: number } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const accessToken = objectProperty(value, "access_token");
  const tokenType = objectProperty(value, "token_type");
  const expiresIn = objectProperty(value, "expires_in");
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    tokenType !== "Bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return undefined;
  }
  return { accessToken, expiresInSeconds: expiresIn };
}

function objectProperty(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function resolveRequestOptions(options: unknown, defaultTimeoutMs: number): ResolvedRequestOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("options must be an object");
  }

  const timeoutMsValue = objectProperty(options, "timeoutMs");
  if (timeoutMsValue !== undefined && typeof timeoutMsValue !== "number") {
    throw new Error("timeoutMs must be a positive number");
  }
  const timeoutMs = timeoutMsValue === undefined ? defaultTimeoutMs : timeoutMsValue;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number");
  }
  const signal = objectProperty(options, "signal");
  if (signal !== undefined && !isAbortSignalLike(signal)) {
    throw new Error("signal must be an AbortSignal");
  }
  return { timeoutMs, deadlineAtMs: Date.now() + timeoutMs, signal };
}

function remainingTimeoutMs(options: ResolvedRequestOptions): number {
  const remainingMs = options.deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw createTimeoutError();
  }
  return remainingMs;
}

function isAbortSignalLike(value: unknown): value is AbortSignalLike {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) {
    return true;
  }
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "aborted") === "boolean" &&
    typeof Reflect.get(value, "addEventListener") === "function" &&
    typeof Reflect.get(value, "removeEventListener") === "function"
  );
}

function isAbortLikeError(value: unknown): boolean {
  if (typeof DOMException !== "undefined" && value instanceof DOMException) {
    return value.name === "AbortError" || value.name === "TimeoutError";
  }
  if (value instanceof Error) {
    return value.name === "AbortError" || value.name === "TimeoutError";
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const name = Reflect.get(value, "name");
  return name === "AbortError" || name === "TimeoutError";
}

function createRequestSignal(options: ResolvedRequestOptions): RequestSignal {
  const timeoutSignal = AbortSignal.timeout(remainingTimeoutMs(options));
  if (options.signal === undefined) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }
  return combineAbortSignals(options.signal, timeoutSignal);
}

function combineAbortSignals(signal: AbortSignalLike, timeoutSignal: AbortSignal): RequestSignal {
  const controller = new AbortController();
  let cleanedUp = false;

  const abortFromSignal = () => abortController(controller, abortReason(signal));
  const abortFromTimeout = () => abortController(controller, abortReason(timeoutSignal));
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    signal.removeEventListener("abort", abortFromSignal);
    timeoutSignal.removeEventListener("abort", abortFromTimeout);
    controller.signal.removeEventListener("abort", cleanup);
  };

  if (signal.aborted) {
    abortFromSignal();
    return { signal: controller.signal, cleanup };
  }
  if (timeoutSignal.aborted) {
    abortFromTimeout();
    return { signal: controller.signal, cleanup };
  }

  signal.addEventListener("abort", abortFromSignal, { once: true });
  timeoutSignal.addEventListener("abort", abortFromTimeout, { once: true });
  controller.signal.addEventListener("abort", cleanup, { once: true });
  return { signal: controller.signal, cleanup };
}

function abortController(controller: AbortController, reason: unknown): void {
  if (controller.signal.aborted) {
    return;
  }
  controller.abort(normaliseAbortReason(reason));
}

async function waitForToken(
  tokenPromise: Promise<CachedToken>,
  options: ResolvedRequestOptions,
): Promise<CachedToken> {
  if (options.signal?.aborted) {
    throw abortReason(options.signal);
  }

  const requestSignal = createRequestSignal(options);
  const signal = requestSignal.signal;
  let removeAbortListener = () => {};

  try {
    if (signal.aborted) {
      throw abortReason(signal);
    }
    const abortPromise = new Promise<CachedToken>((_resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    });
    return await Promise.race([tokenPromise, abortPromise]);
  } finally {
    removeAbortListener();
    requestSignal.cleanup();
  }
}

function abortReason(signal: AbortSignalLike): Error {
  return normaliseAbortReason(Reflect.get(signal, "reason"));
}

function normaliseAbortReason(reason: unknown): Error {
  if (typeof DOMException !== "undefined" && reason instanceof DOMException) {
    return reason;
  }
  if (reason instanceof Error) {
    return reason;
  }
  return createAbortError(reason === undefined ? undefined : String(reason));
}

function createAbortError(message = "The operation was aborted"): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation timed out", "TimeoutError");
  }
  const error = new Error("The operation timed out");
  error.name = "TimeoutError";
  return error;
}

function callHook<T>(hook: ((event: T) => unknown) | undefined, event: T): void {
  try {
    const result = hook?.(event);
    void Promise.resolve(result).catch(() => {
      // Observability hooks must not change API request behaviour.
    });
  } catch {
    // Observability hooks must not change API request behaviour.
  }
}

function extractRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("x-verifiabl-request-id") ??
    undefined
  );
}

function parseBaseUrl(value: string, name: string): string {
  return parseAllowedUrl(value, name).origin;
}

function parseTokenUrl(value: string): string {
  const url = parseUrl(value, "tokenUrl");
  if (!isAllowedTokenUrl(url)) {
    throw new Error("tokenUrl must use a Verifiabl auth host, or localhost for development");
  }
  return url.toString();
}

function parseAllowedUrl(value: string, name: string): URL {
  const url = parseUrl(value, name);
  if (!isAllowedOriginUrl(url)) {
    throw new Error(`${name} must use https, or http for localhost`);
  }
  return url;
}

function parseUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return url;
}

function isAllowedTokenUrl(tokenUrl: URL): boolean {
  if (tokenUrl.protocol === "https:" && VERIFIABL_AUTH_HOSTS.has(tokenUrl.hostname)) {
    return true;
  }
  return (
    (tokenUrl.protocol === "http:" || tokenUrl.protocol === "https:") &&
    isLoopbackHost(tokenUrl.hostname)
  );
}

function isAllowedOriginUrl(originUrl: URL): boolean {
  if (originUrl.protocol === "https:") {
    return true;
  }
  return originUrl.protocol === "http:" && isLoopbackHost(originUrl.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // WHATWG URL serialises the IPv6 loopback as "[::1]"; accept the
  // bracketless form too in case the hostname arrives pre-stripped.
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
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
