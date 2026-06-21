import { VerifiablApiError, VerifiablAuthError, VerifiablClient } from "../client.js";
import type { CreateBarcodeRequest, RegisterNonPiiRequest } from "../types.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv";
const CT = "Zm9v";
const KEY_VERSION = "0f8fad5b-d9cb-469f-a165-70867728950e.1";

const REQUEST: RegisterNonPiiRequest = {
  schema: "au.payslip.v1",
  issuedAt: "2026-06-11T00:00:00Z",
  payslipData: { periodStart: "2026-05-01", periodEnd: "2026-05-31", gross: "9000.00" },
  encryptionMetadata: {
    iv: "AAAAAAAAAAAAAAAA",
    tag: "AAAAAAAAAAAAAAAAAAAAAA",
    keyVersion: KEY_VERSION,
  },
};

const CREATE_BARCODE_REQUEST: CreateBarcodeRequest = {
  ...REQUEST,
  encryptedPii: CT,
};

// The snake_case bodies the SDK is expected to put on the wire after
// translating the camelCase requests above. Provider-specific payslip
// fields (e.g. `gross`) pass through verbatim.
const WIRE_REQUEST = {
  schema: "au.payslip.v1",
  issued_at: "2026-06-11T00:00:00Z",
  payslip_data: { period_start: "2026-05-01", period_end: "2026-05-31", gross: "9000.00" },
  encryption_metadata: {
    iv: "AAAAAAAAAAAAAAAA",
    tag: "AAAAAAAAAAAAAAAAAAAAAA",
    key_version: KEY_VERSION,
  },
};

const WIRE_CREATE_BARCODE_REQUEST = {
  ...WIRE_REQUEST,
  encrypted_pii: CT,
};

const STATIC_AUTH = { auth: { apiKey: "k" } };

function registerResponse(): Response {
  return new Response(JSON.stringify({ id: "x", linking_token: LT }), { status: 201 });
}

function createBarcodeResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "barcode-record",
      symbol: { format: "png", data: "iVBORw0KGgo=", width_px: 720, height_px: 720 },
    }),
    { status: 201 },
  );
}

function mockFetch(status: number, body: unknown): jest.MockedFunction<typeof fetch> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
    return new Response(JSON.stringify(body), { status });
  });
}

function firstFetchCall(fetchMock: jest.MockedFunction<typeof fetch>): Parameters<typeof fetch> {
  const call = fetchMock.mock.calls[0];
  if (call === undefined) {
    throw new Error("Expected fetch to be called");
  }
  return call;
}

function requestBody(call: Parameters<typeof fetch>): unknown {
  const [, init] = call;
  if (init === undefined) {
    throw new Error("Expected fetch init options");
  }
  return JSON.parse(String(init.body));
}

describe("VerifiablClient construction", () => {
  it("requires a non-empty apiKey for static auth", () => {
    expect(() => new VerifiablClient({ auth: { apiKey: "" } })).toThrow("apiKey");
  });

  it("trims static bearer credentials from environment variables", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ auth: { apiKey: " secret-key\n" }, fetch });

    await client.registerNonPii(REQUEST);

    const [, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-key");
  });

  it("reports malformed static auth with a configuration error", () => {
    expect(() => Reflect.construct(VerifiablClient, [{ auth: { apiKey: 42 } }])).toThrow(
      "auth.apiKey must be a string",
    );
  });

  it("requires auth", () => {
    expect(() => Reflect.construct(VerifiablClient, [{}])).toThrow("auth is required");
  });

  it("requires clientId and clientSecret for OAuth auth", () => {
    expect(() => new VerifiablClient({ auth: { clientId: "", clientSecret: "s" } })).toThrow(
      "clientId",
    );
    expect(() => new VerifiablClient({ auth: { clientId: "c", clientSecret: " " } })).toThrow(
      "clientSecret",
    );
    expect(() => Reflect.construct(VerifiablClient, [{ auth: { clientId: "c" } }])).toThrow(
      "auth must include",
    );
  });

  it("rejects mixed auth modes and malformed OAuth options", () => {
    expect(() =>
      Reflect.construct(VerifiablClient, [
        { auth: { apiKey: "k", clientId: "c", clientSecret: "s" } },
      ]),
    ).toThrow("not both");
    expect(() =>
      Reflect.construct(VerifiablClient, [
        { auth: { clientId: "c", clientSecret: "s", tokenUrl: 42 } },
      ]),
    ).toThrow("auth.tokenUrl must be a string");
    expect(() =>
      Reflect.construct(VerifiablClient, [{ auth: { apiKey: "k", tokenUrl: "https://auth" } }]),
    ).toThrow("auth.tokenUrl requires OAuth client credentials");
    expect(() =>
      Reflect.construct(VerifiablClient, [
        { auth: { clientId: "c", clientSecret: "s", tokenUrl: "\n" } },
      ]),
    ).toThrow("auth.tokenUrl must not be empty");
    expect(
      () =>
        new VerifiablClient({
          auth: { clientId: "c", clientSecret: "s", tokenUrl: "https://example.com/oauth/token" },
        }),
    ).toThrow("Verifiabl auth host");
  });

  it("rejects non-https issuer base URLs except local http development", () => {
    expect(
      () => new VerifiablClient({ ...STATIC_AUTH, issuerBaseUrl: "http://api.example" }),
    ).toThrow("https");
  });

  it("allows http for loopback issuer development", () => {
    expect(
      () => new VerifiablClient({ ...STATIC_AUTH, issuerBaseUrl: "http://localhost:3001" }),
    ).not.toThrow();
    expect(
      () => new VerifiablClient({ ...STATIC_AUTH, issuerBaseUrl: "http://127.0.0.1:3001" }),
    ).not.toThrow();
    expect(
      () => new VerifiablClient({ ...STATIC_AUTH, issuerBaseUrl: "http://[::1]:3001" }),
    ).not.toThrow();
  });

  it("rejects invalid timeouts", () => {
    expect(() => new VerifiablClient({ ...STATIC_AUTH, timeoutMs: 0 })).toThrow("timeoutMs");
  });
});

describe("VerifiablClient with static auth", () => {
  it("sends registration to the production issuer origin with bearer auth", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ auth: { apiKey: "secret-key" }, fetch });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linkingToken).toBe(LT);
    const [url, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    expect(url).toBe("https://register.verifiabl.io/v1/registerNonPII");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-key");
    expect(requestBody(firstFetchCall(fetch))).toEqual(WIRE_REQUEST);
  });

  it("routes registration to the sandbox issuer origin", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, environment: "sandbox", fetch });

    await client.registerNonPii(REQUEST);

    expect(firstFetchCall(fetch)[0]).toBe(
      "https://register.sandbox.verifiabl.io/v1/registerNonPII",
    );
  });

  it("does not let passthrough payslipData keys override the mapped period dates", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await client.registerNonPii({
      ...REQUEST,
      payslipData: {
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        // A stray snake_case key in the provider passthrough must not win.
        period_start: "1999-01-01",
        gross: "9000.00",
      },
    });

    const body = requestBody(firstFetchCall(fetch)) as {
      payslip_data: { period_start: string; period_end: string; gross: string };
    };
    expect(body.payslip_data.period_start).toBe("2026-05-01");
    expect(body.payslip_data.period_end).toBe("2026-05-31");
    expect(body.payslip_data.gross).toBe("9000.00");
  });

  it("lets explicit issuer base URL overrides win over the environment", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      environment: "sandbox",
      issuerBaseUrl: "http://localhost:3001",
      fetch,
    });

    await client.registerNonPii(REQUEST);
    expect(firstFetchCall(fetch)[0]).toBe("http://localhost:3001/v1/registerNonPII");
  });

  it("maps the API response to a barcode image for createBarcode", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      return createBarcodeResponse();
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch: fetchMock });

    const result = await client.createBarcode(CREATE_BARCODE_REQUEST);

    expect(result).toEqual({
      id: "barcode-record",
      barcode: { format: "png", data: "iVBORw0KGgo=", widthPx: 720, heightPx: 720 },
    });
    expect(firstFetchCall(fetchMock)[0]).toBe(
      "https://register.verifiabl.io/v1/registerAndBuildSymbol",
    );
    expect(requestBody(firstFetchCall(fetchMock))).toEqual(WIRE_CREATE_BARCODE_REQUEST);
  });

  it("throws VerifiablApiError with the stable code on API errors", async () => {
    const fetch = mockFetch(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      name: "VerifiablApiError",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("surfaces wire field_errors as camelCase fieldErrors on the error body", async () => {
    const fetch = mockFetch(400, {
      error: "Validation failed",
      code: "VALIDATION_FAILED",
      field_errors: [{ path: "records.0", message: "Unrecognized key" }],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      body: { fieldErrors: [{ path: "records.0", message: "Unrecognized key" }] },
    });
  });

  it("includes request ids on API errors when the response has one", async () => {
    const fetchMock: jest.MockedFunction<typeof globalThis.fetch> = jest.fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >(async () => {
      return new Response(JSON.stringify({ error: "Forbidden", code: "FORBIDDEN" }), {
        status: 403,
        headers: { "x-request-id": "req_123" },
      });
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch: fetchMock });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      requestId: "req_123",
    });
  });

  it("passes through error codes this SDK version does not know", async () => {
    const fetch = mockFetch(429, { error: "Slow down", code: "RATE_LIMITED" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("tolerates additive fields in success responses", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT, audit_ref: "future-field" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linkingToken).toBe(LT);
  });

  it("survives non-JSON error bodies", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      return new Response("not json", { status: 502 });
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch: fetchMock });

    let error: unknown;
    try {
      await client.registerNonPii(REQUEST);
    } catch (err) {
      error = err;
    }
    if (!(error instanceof VerifiablApiError)) {
      throw new Error("Expected VerifiablApiError");
    }
    expect(error.status).toBe(502);
  });

  it("rejects invalid per-request timeouts before sending", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPii(REQUEST, { timeoutMs: 0 })).rejects.toThrow("timeoutMs");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports malformed per-request options with configuration errors", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    // @ts-expect-error Exercise JavaScript runtime input validation.
    await expect(client.registerNonPii(REQUEST, null)).rejects.toThrow("options must be an object");
    await expect(
      // @ts-expect-error Exercise JavaScript runtime input validation.
      client.registerNonPii(REQUEST, { signal: { aborted: false } }),
    ).rejects.toThrow("signal must be an AbortSignal");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts abort-signal-like objects with members on the prototype", async () => {
    class PrototypeSignal {
      aborted = false;
      reason: unknown;
      private readonly listeners: Array<() => void> = [];

      addEventListener(type: "abort", listener: () => void): void {
        if (type === "abort") {
          this.listeners.push(listener);
        }
      }

      removeEventListener(type: "abort", listener: () => void): void {
        if (type !== "abort") {
          return;
        }
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      }

      abort(reason: unknown): void {
        this.aborted = true;
        this.reason = reason;
        for (const listener of this.listeners) {
          listener();
        }
      }

      listenerCount(): number {
        return this.listeners.length;
      }
    }

    const successSignal = new PrototypeSignal();
    let successFetchSignal: AbortSignal | undefined;
    const successFetchMock: jest.MockedFunction<typeof globalThis.fetch> = jest.fn(
      async (_input, init) => {
        if (init?.signal instanceof AbortSignal) {
          successFetchSignal = init.signal;
        }
        return registerResponse();
      },
    );
    const successClient = new VerifiablClient({ ...STATIC_AUTH, fetch: successFetchMock });

    // @ts-expect-error Exercise JavaScript runtime input validation.
    await successClient.registerNonPii(REQUEST, { signal: successSignal });

    expect(successFetchSignal).toBeInstanceOf(AbortSignal);
    expect(successFetchSignal?.aborted).toBe(false);
    expect(successSignal.listenerCount()).toBe(0);
    successSignal.abort("late abort");
    expect(successFetchSignal?.aborted).toBe(false);

    const signal = new PrototypeSignal();
    let fetchSignal: AbortSignal | undefined;
    const fetchMock: jest.MockedFunction<typeof globalThis.fetch> = jest.fn(
      async (_input, init) => {
        if (init?.signal instanceof AbortSignal) {
          fetchSignal = init.signal;
        }
        signal.abort("caller aborted");
        return registerResponse();
      },
    );
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch: fetchMock });

    // @ts-expect-error Exercise JavaScript runtime input validation.
    await client.registerNonPii(REQUEST, { signal });

    expect(fetchSignal).toBeInstanceOf(AbortSignal);
    expect(fetchSignal?.aborted).toBe(true);
    expect(fetchSignal?.reason).toMatchObject({ name: "AbortError", message: "caller aborted" });
    expect(signal.listenerCount()).toBe(0);
  });

  it("emits request and response hooks without bodies", async () => {
    const requests: unknown[] = [];
    const responses: unknown[] = [];
    const fetchMock: jest.MockedFunction<typeof globalThis.fetch> = jest.fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >(async () => {
      return new Response(JSON.stringify({ id: "x", linking_token: LT }), {
        status: 201,
        headers: { "x-request-id": "req_hook" },
      });
    });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      fetch: fetchMock,
      onRequest: (event) => requests.push(event),
      onResponse: (event) => responses.push(event),
    });

    await client.registerNonPii(REQUEST, { timeoutMs: 1_000 });

    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://register.verifiabl.io/v1/registerNonPII",
        path: "/v1/registerNonPII",
      },
    ]);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      method: "POST",
      url: "https://register.verifiabl.io/v1/registerNonPII",
      path: "/v1/registerNonPII",
      status: 201,
      requestId: "req_hook",
    });
    expect(responses[0]).toHaveProperty("elapsedMs");
    expect(responses[0]).not.toHaveProperty("body");
  });

  it("does not let observability hook failures change request behaviour", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      fetch,
      onRequest: () => {
        throw new Error("hook failed");
      },
      onResponse: () => {
        throw new Error("hook failed");
      },
    });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linkingToken).toBe(LT);
  });

  it("does not let async observability hook failures change request behaviour", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      fetch,
      onRequest: async () => {
        throw new Error("hook failed");
      },
      onResponse: async () => {
        throw new Error("hook failed");
      },
    });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linkingToken).toBe(LT);
  });

  it("emits error hooks when issuer API fetch fails", async () => {
    const requests: unknown[] = [];
    const responses: unknown[] = [];
    const errors: unknown[] = [];
    const fetchError = new Error("network failed");
    const fetchMock: jest.MockedFunction<typeof globalThis.fetch> = jest.fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >(async () => {
      throw fetchError;
    });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      fetch: fetchMock,
      onRequest: (event) => requests.push(event),
      onResponse: (event) => responses.push(event),
      onError: (event) => errors.push(event),
    });

    await expect(client.registerNonPii(REQUEST)).rejects.toBe(fetchError);

    expect(requests).toHaveLength(1);
    expect(responses).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      method: "POST",
      url: "https://register.verifiabl.io/v1/registerNonPII",
      path: "/v1/registerNonPII",
      error: fetchError,
    });
    expect(errors[0]).toHaveProperty("elapsedMs");
  });

  it("validates request bodies before sending", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({
        ...REQUEST,
        encryptionMetadata: { ...REQUEST.encryptionMetadata, iv: "short" },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects key versions outside the deployed contract before sending", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({
        ...REQUEST,
        encryptionMetadata: { ...REQUEST.encryptionMetadata, keyVersion: "v1" },
      }),
    ).rejects.toThrow("provider-id");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects issuedAt with a UTC offset, matching the API", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: LT });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({ ...REQUEST, issuedAt: "2026-06-11T10:00:00+10:00" }),
    ).rejects.toThrow("UTC");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("VerifiablClient with OAuth client credentials", () => {
  const OAUTH = { clientId: "demo-client", clientSecret: "demo-secret" };

  function tokenResponse(token: string, expiresIn = 3600): Response {
    return new Response(
      JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: expiresIn }),
      { status: 200 },
    );
  }

  function oauthFetch(handlers: {
    token?: (body: unknown) => Response;
    api?: (url: string, authorization: string | null) => Response;
  }): jest.MockedFunction<typeof fetch> {
    return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (input, init) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        const body: unknown = JSON.parse(String(init?.body));
        return handlers.token?.(body) ?? tokenResponse("tok");
      }
      const authorization = new Headers(init?.headers).get("authorization");
      return handlers.api?.(url, authorization) ?? registerResponse();
    });
  }

  it("fetches a token with the issuer audience and scope for registration", async () => {
    const tokenBodies: unknown[] = [];
    const fetch = oauthFetch({
      token: (body) => {
        tokenBodies.push(body);
        return tokenResponse("issuer-token");
      },
      api: (_url, authorization) => {
        expect(authorization).toBe("Bearer issuer-token");
        return registerResponse();
      },
    });
    const client = new VerifiablClient({ auth: OAUTH, environment: "sandbox", fetch });

    await client.registerNonPii(REQUEST);

    expect(tokenBodies).toEqual([
      {
        grant_type: "client_credentials",
        client_id: "demo-client",
        client_secret: "demo-secret",
        audience: "https://register.sandbox.verifiabl.io",
        scope: "verifiabl:issuer",
      },
    ]);
    expect(firstFetchCall(fetch)[0]).toBe("https://auth.sandbox.verifiabl.io/oauth/token");
  });

  it("trims OAuth credentials before requesting a token", async () => {
    const tokenBodies: unknown[] = [];
    const fetch = oauthFetch({
      token: (body) => {
        tokenBodies.push(body);
        return tokenResponse("issuer-token");
      },
    });
    const client = new VerifiablClient({
      auth: { clientId: " demo-client\n", clientSecret: " demo-secret\n" },
      fetch,
    });

    await client.registerNonPii(REQUEST);

    expect(tokenBodies).toEqual([
      expect.objectContaining({ client_id: "demo-client", client_secret: "demo-secret" }),
    ]);
  });

  it("trims OAuth token URL overrides before parsing", async () => {
    const fetch = oauthFetch({});
    const client = new VerifiablClient({
      auth: {
        clientId: "demo-client",
        clientSecret: "demo-secret",
        tokenUrl: " http://localhost:3001/oauth/token\n",
      },
      fetch,
    });

    await client.registerNonPii(REQUEST);

    expect(firstFetchCall(fetch)[0]).toBe("http://localhost:3001/oauth/token");
  });

  it("caches the token across issuer calls", async () => {
    let tokenRequests = 0;
    const fetch = oauthFetch({
      token: () => {
        tokenRequests += 1;
        return tokenResponse(`tok-${tokenRequests}`);
      },
      api: (url) =>
        url.includes("registerAndBuildSymbol") ? createBarcodeResponse() : registerResponse(),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await client.registerNonPii(REQUEST);
    await client.createBarcode(CREATE_BARCODE_REQUEST);

    expect(tokenRequests).toBe(1);
  });

  it("reuses short-lived tokens before they enter their refresh window", async () => {
    let tokenRequests = 0;
    const fetch = oauthFetch({
      token: () => {
        tokenRequests += 1;
        return tokenResponse(`tok-${tokenRequests}`, 30);
      },
      api: (url) =>
        url.includes("registerAndBuildSymbol") ? createBarcodeResponse() : registerResponse(),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await client.registerNonPii(REQUEST);
    await client.createBarcode(CREATE_BARCODE_REQUEST);

    expect(tokenRequests).toBe(1);
  });

  it("deduplicates concurrent issuer token requests", async () => {
    let tokenRequests = 0;
    const fetch = oauthFetch({
      token: () => {
        tokenRequests += 1;
        return tokenResponse("shared-token");
      },
      api: (_url, authorization) => {
        expect(authorization).toBe("Bearer shared-token");
        return registerResponse();
      },
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await Promise.all([client.registerNonPii(REQUEST), client.registerNonPii(REQUEST)]);

    expect(tokenRequests).toBe(1);
  });

  it("refreshes the token and retries once on a 401", async () => {
    let tokenRequests = 0;
    let apiCalls = 0;
    const fetch = oauthFetch({
      token: () => {
        tokenRequests += 1;
        return tokenResponse(`tok-${tokenRequests}`);
      },
      api: (_url, authorization) => {
        apiCalls += 1;
        if (apiCalls === 1) {
          return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
            status: 401,
          });
        }
        expect(authorization).toBe("Bearer tok-2");
        return registerResponse();
      },
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linkingToken).toBe(LT);
    expect(tokenRequests).toBe(2);
    expect(apiCalls).toBe(2);
  });

  it("applies timeoutMs across token fetch, API call, and 401 retry", async () => {
    let nowMs = 0;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const timeoutWindows: number[] = [];
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs) => {
      timeoutWindows.push(timeoutMs);
      return new AbortController().signal;
    });
    try {
      let tokenRequests = 0;
      let apiCalls = 0;
      const fetch = oauthFetch({
        token: () => {
          tokenRequests += 1;
          nowMs += tokenRequests === 1 ? 300 : 150;
          return tokenResponse(`tok-${tokenRequests}`);
        },
        api: () => {
          apiCalls += 1;
          if (apiCalls === 1) {
            nowMs += 500;
            return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
              status: 401,
            });
          }
          return registerResponse();
        },
      });
      const client = new VerifiablClient({ auth: OAUTH, fetch });

      await client.registerNonPii(REQUEST, { timeoutMs: 1_000 });

      expect(timeoutWindows).toEqual([1_000, 700, 200, 50]);
      expect(tokenRequests).toBe(2);
      expect(apiCalls).toBe(2);
    } finally {
      nowSpy.mockRestore();
      timeoutSpy.mockRestore();
    }
  });

  it("surfaces a persistent 401 as VerifiablApiError after one retry", async () => {
    let apiCalls = 0;
    const fetch = oauthFetch({
      api: () => {
        apiCalls += 1;
        return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
          status: 401,
        });
      },
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      name: "VerifiablApiError",
      status: 401,
    });
    expect(apiCalls).toBe(2);
  });

  it("throws VerifiablAuthError when the token endpoint fails", async () => {
    const fetch = oauthFetch({
      token: () => new Response("denied", { status: 403 }),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      name: "VerifiablAuthError",
      status: 403,
    });
  });

  it("preserves abort errors from OAuth token requests", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      throw abortError;
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch: fetchMock });

    await expect(client.registerNonPii(REQUEST)).rejects.toBe(abortError);
  });

  it("preserves caller aborts from OAuth token requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error("caller aborted");
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      throw abortError;
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch: fetchMock });

    await expect(client.registerNonPii(REQUEST, { signal: controller.signal })).rejects.toBe(
      abortError,
    );
  });

  it("throws VerifiablAuthError on a malformed token response", async () => {
    const fetch = oauthFetch({
      token: () => new Response(JSON.stringify({ access_token: "", token_type: "Bearer" })),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await expect(client.registerNonPii(REQUEST)).rejects.toBeInstanceOf(VerifiablAuthError);
  });

  it("requests a fresh token once the cached one nears expiry", async () => {
    jest.useFakeTimers();
    try {
      let tokenRequests = 0;
      const fetch = oauthFetch({
        token: () => {
          tokenRequests += 1;
          return tokenResponse(`tok-${tokenRequests}`, 120);
        },
      });
      const client = new VerifiablClient({ auth: OAUTH, fetch });

      await client.registerNonPii(REQUEST);
      jest.advanceTimersByTime(90_000);
      await client.registerNonPii(REQUEST);

      expect(tokenRequests).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
