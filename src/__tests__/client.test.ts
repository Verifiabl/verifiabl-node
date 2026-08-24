import {
  VerifiablApiError,
  VerifiablAuthError,
  VerifiablClient,
  VerifiablIvReuseError,
} from "../client.js";
import type {
  RegisterAndBuildBarcodeRequest,
  RegisterNonPiiBatchRequest,
  RegisterNonPiiRequest,
} from "../types.js";
import { isIvReuseResult } from "../types.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv";
const CIPHERTEXT = "Zm9v";

const REQUEST: RegisterNonPiiRequest = {
  schema: "au.payslip.v1",
  issuedAt: "2026-06-11T00:00:00Z",
  // Balances: 900000 - 225000 (paygw) = 675000.
  payslipNonPii: {
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    paymentDate: "2026-06-04",
    currency: "AUD",
    grossCents: 900_000,
    paygwCents: 225_000,
    netCents: 675_000,
    ytdGrossCents: 900_000,
    ytdPaygwCents: 225_000,
  },
  encryptionMetadata: {
    iv: "AAAAAAAAAAAAAAAA",
    tag: "AAAAAAAAAAAAAAAAAAAAAA",
  },
};

const REGISTER_AND_BUILD_BARCODE_REQUEST: RegisterAndBuildBarcodeRequest = {
  ...REQUEST,
  encryptedPii: CIPHERTEXT,
};

// The snake_case bodies the SDK is expected to put on the wire after
// translating the camelCase requests above. Provider-specific payslip
// fields (e.g. `gross`) pass through verbatim.
const WIRE_REQUEST = {
  schema: "au.payslip.v1",
  issued_at: "2026-06-11T00:00:00Z",
  payslip_non_pii: {
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    payment_date: "2026-06-04",
    currency: "AUD",
    gross_cents: 900_000,
    paygw_cents: 225_000,
    net_cents: 675_000,
    ytd_gross_cents: 900_000,
    ytd_paygw_cents: 225_000,
  },
  encryption_metadata: {
    iv: "AAAAAAAAAAAAAAAA",
    tag: "AAAAAAAAAAAAAAAAAAAAAA",
  },
};

const WIRE_REGISTER_AND_BUILD_BARCODE_REQUEST = {
  ...WIRE_REQUEST,
  encrypted_pii: CIPHERTEXT,
};

const STATIC_AUTH = { auth: { apiKey: "k" } };

function registerResponse(): Response {
  return new Response(JSON.stringify({ verifiabl_reference: VERIFIABL_REF }), { status: 201 });
}

function registerAndBuildBarcodeResponse(): Response {
  return new Response(
    JSON.stringify({
      verifiabl_reference: VERIFIABL_REF,
      barcode: { format: "png", data: "iVBORw0KGgo=" },
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ auth: { apiKey: "secret-key" }, fetch });

    const result = await client.registerNonPii(REQUEST);

    expect(result.verifiablReference).toBe(VERIFIABL_REF);
    const [url, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    expect(url).toBe("https://register.verifiabl.io/v1/registerNonPII");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-key");
    expect(requestBody(firstFetchCall(fetch))).toEqual(WIRE_REQUEST);
  });

  it("routes registration to the sandbox issuer origin", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, environment: "sandbox", fetch });

    await client.registerNonPii(REQUEST);

    expect(firstFetchCall(fetch)[0]).toBe(
      "https://register.sandbox.verifiabl.io/v1/registerNonPII",
    );
  });

  // The schema is closed, so there is no passthrough to fight over any more: an
  // unrecognised key is a local error rather than something the API rejects with
  // a 400 (and it is what stops PII reaching the record).
  it("rejects an unknown payslipNonPii key without calling the API", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(
      client.registerNonPii({
        ...REQUEST,
        payslipNonPii: {
          ...REQUEST.payslipNonPii,
          employeeName: "Alice Smith",
        } as unknown as RegisterNonPiiRequest["payslipNonPii"],
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps every canonical field to its snake_case wire name", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await client.registerNonPii({
      ...REQUEST,
      payslipNonPii: {
        ...REQUEST.payslipNonPii,
        taxableGrossCents: 900_000,
        stslWithholdingCents: 25_000,
        employmentBasis: "full_time",
        earnings: [
          { type: "ordinary", amountCents: 880_000 },
          {
            type: "allowance",
            allowanceType: "other",
            otherCategory: "uniform",
            amountCents: 20_000,
          },
        ],
        superannuation: [
          { contributionType: "superannuation_guarantee", amountCents: 99_000, usi: "STA0100AU" },
        ],
        ytd: { taxableCents: 900_000 },
      },
    });

    const body = requestBody(firstFetchCall(fetch)) as { payslip_non_pii: Record<string, unknown> };
    expect(body.payslip_non_pii).toEqual({
      period_start: "2026-05-01",
      period_end: "2026-05-31",
      payment_date: "2026-06-04",
      currency: "AUD",
      gross_cents: 900_000,
      paygw_cents: 225_000,
      net_cents: 675_000,
      ytd_gross_cents: 900_000,
      ytd_paygw_cents: 225_000,
      taxable_gross_cents: 900_000,
      stsl_withholding_cents: 25_000,
      employment_basis: "full_time",
      earnings: [
        { type: "ordinary", amount_cents: 880_000 },
        {
          type: "allowance",
          allowance_type: "other",
          other_category: "uniform",
          amount_cents: 20_000,
        },
      ],
      superannuation: [
        { contribution_type: "superannuation_guarantee", amount_cents: 99_000, usi: "STA0100AU" },
      ],
      ytd: { taxable_cents: 900_000 },
    });
  });

  // A YYYY-MM-DD regex would pass these; the API validates real calendar dates,
  // so accepting them locally would just move the failure to registration.
  it("rejects a date that cannot exist", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    for (const paymentDate of ["2026-02-31", "2026-13-01", "2027-02-29"]) {
      await expect(
        client.registerNonPii({
          ...REQUEST,
          payslipNonPii: { ...REQUEST.payslipNonPii, paymentDate },
        }),
      ).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();

    // A real leap day is fine.
    await client.registerNonPii({
      ...REQUEST,
      payslipNonPii: { ...REQUEST.payslipNonPii, paymentDate: "2028-02-29" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // Every supported currency has an ISO 4217 minor-unit exponent of 2, so the
  // `*Cents` fields stay literally cents. JPY (exponent 0) would reinterpret the
  // same integer at a hundredfold different scale.
  it("accepts a non-AUD exponent-2 currency and rejects one with another exponent", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await client.registerNonPii({
      ...REQUEST,
      payslipNonPii: { ...REQUEST.payslipNonPii, currency: "NZD" },
    });
    expect(requestBody(firstFetchCall(fetch))).toMatchObject({
      payslip_non_pii: { currency: "NZD" },
    });

    await expect(
      client.registerNonPii({
        ...REQUEST,
        payslipNonPii: {
          ...REQUEST.payslipNonPii,
          currency: "JPY",
        } as unknown as RegisterNonPiiRequest["payslipNonPii"],
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // Verifiabl attests the document, not the arithmetic. An implausible payslip
  // is still a real issued document, so the SDK sends the issuer's figures as
  // given rather than adjudicating them locally.
  it("sends figures that do not reconcile, as issued", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await client.registerNonPii({
      ...REQUEST,
      payslipNonPii: {
        ...REQUEST.payslipNonPii,
        netCents: 999_999,
        earnings: [{ type: "ordinary", amountCents: 1 }],
      },
    });

    expect(requestBody(firstFetchCall(fetch))).toMatchObject({
      payslip_non_pii: {
        net_cents: 999_999,
        earnings: [{ type: "ordinary", amount_cents: 1 }],
      },
    });
  });

  it("rejects a period that ends before it starts, before the request is sent", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(
      client.registerNonPii({
        ...REQUEST,
        payslipNonPii: {
          ...REQUEST.payslipNonPii,
          periodStart: "2026-05-31",
          periodEnd: "2026-05-01",
        },
      }),
    ).rejects.toThrow(/periodEnd must not be before periodStart/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets explicit issuer base URL overrides win over the environment", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({
      ...STATIC_AUTH,
      environment: "sandbox",
      issuerBaseUrl: "http://localhost:3001",
      fetch,
    });

    await client.registerNonPii(REQUEST);
    expect(firstFetchCall(fetch)[0]).toBe("http://localhost:3001/v1/registerNonPII");
  });

  it("maps the API response to a barcode image for registerAndBuildBarcode", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      return registerAndBuildBarcodeResponse();
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch: fetchMock });

    const result = await client.registerAndBuildBarcode(REGISTER_AND_BUILD_BARCODE_REQUEST);

    expect(result).toEqual({
      verifiablReference: VERIFIABL_REF,
      barcode: { format: "png", data: "iVBORw0KGgo=" },
    });
    expect(firstFetchCall(fetchMock)[0]).toBe(
      "https://register.verifiabl.io/v1/registerAndBuildBarcode",
    );
    expect(requestBody(firstFetchCall(fetchMock))).toEqual(WIRE_REGISTER_AND_BUILD_BARCODE_REQUEST);
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

  it("throws VerifiablIvReuseError when the API rejects a reused iv", async () => {
    const fetch = mockFetch(409, {
      error: "Conflict",
      code: "IV_REUSED",
      detail:
        "encryption_metadata.iv has already been used by this issuer; re-encrypt the record with a fresh iv",
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const err: unknown = await client.registerNonPii(REQUEST).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VerifiablIvReuseError);
    // The subclass must stay catchable by existing VerifiablApiError handling.
    expect(err).toBeInstanceOf(VerifiablApiError);
    expect(err).toMatchObject({
      name: "VerifiablIvReuseError",
      status: 409,
      code: "IV_REUSED",
      body: { detail: expect.stringContaining("fresh iv") },
    });
    // The remedy has to be in the message: "Conflict" alone tells nobody what to do.
    expect((err as Error).message).toContain("encryptPii");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws VerifiablIvReuseError from registerAndBuildBarcode too", async () => {
    const fetch = mockFetch(409, { error: "Conflict", code: "IV_REUSED" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(
      client.registerAndBuildBarcode(REGISTER_AND_BUILD_BARCODE_REQUEST),
    ).rejects.toBeInstanceOf(VerifiablIvReuseError);
  });

  it("leaves a reference conflict as a plain VerifiablApiError", async () => {
    const fetch = mockFetch(409, {
      error: "Conflict",
      code: "CONFLICT",
      detail: "verifiabl_reference already registered with different data",
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const err: unknown = await client.registerNonPii(REQUEST).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VerifiablApiError);
    expect(err).not.toBeInstanceOf(VerifiablIvReuseError);
    expect(err).toMatchObject({ name: "VerifiablApiError", status: 409, code: "CONFLICT" });
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

  it("omits fieldErrors from the error body when the API sends none", async () => {
    const fetch = mockFetch(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const err: unknown = await client.registerNonPii(REQUEST).catch((e: unknown) => e);
    if (!(err instanceof VerifiablApiError) || err.body === undefined) {
      throw new Error("expected a VerifiablApiError with a body");
    }
    expect("fieldErrors" in err.body).toBe(false);
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF, audit_ref: "future-field" });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPii(REQUEST);

    expect(result.verifiablReference).toBe(VERIFIABL_REF);
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPii(REQUEST, { timeoutMs: 0 })).rejects.toThrow("timeoutMs");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports malformed per-request options with configuration errors", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
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
      return new Response(JSON.stringify({ verifiabl_reference: VERIFIABL_REF }), {
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
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

    expect(result.verifiablReference).toBe(VERIFIABL_REF);
  });

  it("does not let async observability hook failures change request behaviour", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
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

    expect(result.verifiablReference).toBe(VERIFIABL_REF);
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
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({
        ...REQUEST,
        encryptionMetadata: { ...REQUEST.encryptionMetadata, iv: "short" },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects the retired keyVersion field before sending", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({
        ...REQUEST,
        encryptionMetadata: {
          ...REQUEST.encryptionMetadata,
          keyVersion: "0f8fad5b-d9cb-469f-a165-70867728950e.1",
        } as never,
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects issuedAt with a UTC offset, matching the API", async () => {
    const fetch = mockFetch(201, { verifiabl_reference: VERIFIABL_REF });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });
    await expect(
      client.registerNonPii({ ...REQUEST, issuedAt: "2026-06-11T10:00:00+10:00" }),
    ).rejects.toThrow("UTC");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("VerifiablClient.registerNonPiiBatch", () => {
  const VERIFIABL_REF_A = "AbCdEfGhIjKlMnOpQrStUv";
  const VERIFIABL_REF_B = "WxYz0123456789ABCDEFGH";

  const BATCH_REQUEST: RegisterNonPiiBatchRequest = {
    records: [
      { ...REQUEST, verifiablReference: VERIFIABL_REF_A },
      { ...REQUEST, verifiablReference: VERIFIABL_REF_B },
    ],
  };

  function batchResponseBody(): unknown {
    return {
      results: [
        { status: "created", verifiabl_reference: VERIFIABL_REF_A },
        {
          status: "error",
          verifiabl_reference: VERIFIABL_REF_B,
          code: "CONFLICT",
          detail: "verifiabl_reference already registered with different data",
        },
      ],
    };
  }

  // Batch promises that one bad record never fails the whole batch, so a record
  // the SDK rejects locally must not cost the caller the rest of the pay run.
  it("registers the good records and reports the bad one, in input order", async () => {
    const fetch = mockFetch(200, {
      results: [{ status: "created", verifiabl_reference: VERIFIABL_REF_B }],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        {
          ...REQUEST,
          verifiablReference: VERIFIABL_REF_A,
          externalId: "payslip-1",
          // Money is integer cents, so a fractional amount is rejected locally
          // and never sent.
          payslipNonPii: { ...REQUEST.payslipNonPii, grossCents: 900_000.55 },
        },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B },
      ],
    });

    // Only the conforming record went to the API.
    expect(requestBody(firstFetchCall(fetch))).toEqual({
      records: [{ verifiabl_reference: VERIFIABL_REF_B, ...WIRE_REQUEST }],
    });

    // results[i] still lines up with records[i].
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      status: "error",
      code: "VALIDATION_FAILED",
      verifiablReference: VERIFIABL_REF_A,
      externalId: "payslip-1",
    });
    expect(result.results[0]?.detail).toContain("grossCents");
    expect(result.results[1]).toEqual({
      status: "created",
      verifiablReference: VERIFIABL_REF_B,
    });
  });

  // An unsupported version is one record's problem, exactly as at the API: it
  // must not throw the batch, and the SDK cannot validate a payload it has no
  // schema for.
  it("reports an unsupported schema version per record", async () => {
    const fetch = mockFetch(200, {
      results: [{ status: "created", verifiabl_reference: VERIFIABL_REF_B }],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        {
          ...REQUEST,
          schema: "au.payslip.v2" as RegisterNonPiiBatchRequest["records"][number]["schema"],
          verifiablReference: VERIFIABL_REF_A,
        },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B },
      ],
    });

    expect(requestBody(firstFetchCall(fetch))).toEqual({
      records: [{ verifiabl_reference: VERIFIABL_REF_B, ...WIRE_REQUEST }],
    });
    expect(result.results[0]).toMatchObject({
      status: "error",
      code: "VALIDATION_FAILED",
      detail: "unsupported schema 'au.payslip.v2'",
      verifiablReference: VERIFIABL_REF_A,
    });
    expect(result.results[1]).toMatchObject({ status: "created" });
  });

  it("does not call the API when every record fails locally", async () => {
    const fetch = mockFetch(200, { results: [] });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        {
          ...REQUEST,
          verifiablReference: VERIFIABL_REF_A,
          payslipNonPii: { ...REQUEST.payslipNonPii, netCents: 675_000.55 },
        },
      ],
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ status: "error", code: "VALIDATION_FAILED" });
  });

  // If the API returns fewer results than we sent, the missing slots must still
  // be correlatable: fill them from the record's own reference, not undefined.
  it("fills a missing API result from the sent record's reference", async () => {
    const fetch = mockFetch(200, {
      results: [{ status: "created", verifiabl_reference: VERIFIABL_REF_A }],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        { ...REQUEST, verifiablReference: VERIFIABL_REF_A },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B, externalId: "payslip-2" },
      ],
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      status: "created",
      verifiablReference: VERIFIABL_REF_A,
    });
    expect(result.results[1]).toEqual({
      status: "error",
      code: "INTERNAL_ERROR",
      detail: "no result returned for record at index 1",
      verifiablReference: VERIFIABL_REF_B,
      externalId: "payslip-2",
    });
  });

  it("posts the batch to the batch endpoint with the wire body and maps the response", async () => {
    const fetch = mockFetch(200, batchResponseBody());
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch(BATCH_REQUEST);

    const [url] = firstFetchCall(fetch);
    expect(url).toBe("https://register.verifiabl.io/v1/registerNonPIIBatch");
    expect(requestBody(firstFetchCall(fetch))).toEqual({
      records: [
        { verifiabl_reference: VERIFIABL_REF_A, ...WIRE_REQUEST },
        { verifiabl_reference: VERIFIABL_REF_B, ...WIRE_REQUEST },
      ],
    });
    expect(result.results).toEqual([
      { status: "created", verifiablReference: VERIFIABL_REF_A },
      {
        status: "error",
        verifiablReference: VERIFIABL_REF_B,
        code: "CONFLICT",
        detail: "verifiabl_reference already registered with different data",
      },
    ]);
  });

  it("sends externalId as external_id on the wire and maps it back onto the result", async () => {
    const fetch = mockFetch(200, {
      results: [
        {
          status: "created",
          verifiabl_reference: VERIFIABL_REF_A,
          external_id: "payslip-1",
        },
        { status: "created", verifiabl_reference: VERIFIABL_REF_B },
      ],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        { ...REQUEST, verifiablReference: VERIFIABL_REF_A, externalId: "payslip-1" },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B },
      ],
    });

    // Sent snake_case, and only when supplied.
    expect(requestBody(firstFetchCall(fetch))).toEqual({
      records: [
        { verifiabl_reference: VERIFIABL_REF_A, external_id: "payslip-1", ...WIRE_REQUEST },
        { verifiabl_reference: VERIFIABL_REF_B, ...WIRE_REQUEST },
      ],
    });
    // Mapped back camelCase on the matching result; absent when the API omits it.
    expect(result.results[0]).toEqual({
      status: "created",
      verifiablReference: VERIFIABL_REF_A,
      externalId: "payslip-1",
    });
    expect(result.results[1]).not.toHaveProperty("externalId");
  });

  it("routes the batch to the sandbox issuer origin", async () => {
    const fetch = mockFetch(200, { results: [] });
    const client = new VerifiablClient({ ...STATIC_AUTH, environment: "sandbox", fetch });

    await client.registerNonPiiBatch({
      records: [{ ...REQUEST, verifiablReference: VERIFIABL_REF_A }],
    });

    expect(firstFetchCall(fetch)[0]).toBe(
      "https://register.sandbox.verifiabl.io/v1/registerNonPIIBatch",
    );
  });

  it("surfaces the three per-record statuses, including idempotent duplicates", async () => {
    // A resend of the same record set: the API replays "duplicate" for content
    // that already exists under this reference, "error"/CONFLICT for a
    // reference that exists with different content, and "created" for new ones.
    const VERIFIABL_REF_C = "ZyXwVuTsRqPoNmLkJiHgFe";
    const fetch = mockFetch(200, {
      results: [
        { status: "duplicate", verifiabl_reference: VERIFIABL_REF_A },
        {
          status: "error",
          verifiabl_reference: VERIFIABL_REF_B,
          code: "CONFLICT",
          detail: "verifiabl_reference already registered with different data",
        },
        { status: "created", verifiabl_reference: VERIFIABL_REF_C },
      ],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        { ...REQUEST, verifiablReference: VERIFIABL_REF_A },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_C },
      ],
    });

    expect(result.results.map((r) => r.status)).toEqual(["duplicate", "error", "created"]);
    expect(result.results[0]).toEqual({
      status: "duplicate",
      verifiablReference: VERIFIABL_REF_A,
    });
    expect(result.results[1]).toEqual({
      status: "error",
      verifiablReference: VERIFIABL_REF_B,
      code: "CONFLICT",
      detail: "verifiabl_reference already registered with different data",
    });
  });

  // A reused iv is per-record at the API, so it must not throw the batch and
  // must stay distinguishable from a reference conflict on the same 409 family.
  it("surfaces a reused iv as a per-record error result", async () => {
    const VERIFIABL_REF_C = "ZyXwVuTsRqPoNmLkJiHgFe";
    const fetch = mockFetch(200, {
      results: [
        { status: "created", verifiabl_reference: VERIFIABL_REF_A },
        {
          status: "error",
          verifiabl_reference: VERIFIABL_REF_B,
          code: "IV_REUSED",
          detail:
            "encryption_metadata.iv has already been used by this issuer; re-encrypt the record with a fresh iv",
          external_id: "payslip-2",
        },
        {
          status: "error",
          verifiabl_reference: VERIFIABL_REF_C,
          code: "IV_REUSED",
          detail:
            "duplicate encryption_metadata.iv within batch; re-encrypt the record with a fresh iv",
        },
      ],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [
        { ...REQUEST, verifiablReference: VERIFIABL_REF_A },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_B, externalId: "payslip-2" },
        { ...REQUEST, verifiablReference: VERIFIABL_REF_C },
      ],
    });

    expect(result.results.map(isIvReuseResult)).toEqual([false, true, true]);
    expect(result.results[1]).toEqual({
      status: "error",
      verifiablReference: VERIFIABL_REF_B,
      externalId: "payslip-2",
      code: "IV_REUSED",
      detail:
        "encryption_metadata.iv has already been used by this issuer; re-encrypt the record with a fresh iv",
    });
    expect(result.results[2]?.detail).toContain("within batch");
  });

  it("does not treat a reference conflict as iv reuse", async () => {
    const fetch = mockFetch(200, batchResponseBody());
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch(BATCH_REQUEST);

    expect(result.results.map((entry) => entry.code)).toEqual([undefined, "CONFLICT"]);
    expect(result.results.some(isIvReuseResult)).toBe(false);
  });

  it("passes through batch statuses this SDK version does not know", async () => {
    const fetch = mockFetch(200, {
      results: [{ status: "skipped", verifiabl_reference: VERIFIABL_REF_A }],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [{ ...REQUEST, verifiablReference: VERIFIABL_REF_A }],
    });

    expect(result.results[0]).toEqual({
      status: "skipped",
      verifiablReference: VERIFIABL_REF_A,
    });
  });

  it("tolerates additive fields in batch results", async () => {
    const fetch = mockFetch(200, {
      results: [
        {
          status: "created",
          verifiabl_reference: VERIFIABL_REF_A,
          // The API may add per-record fields (e.g. an id); ignore them.
          id: "rec_123",
        },
      ],
    });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const result = await client.registerNonPiiBatch({
      records: [{ ...REQUEST, verifiablReference: VERIFIABL_REF_A }],
    });

    expect(result.results).toEqual([{ status: "created", verifiablReference: VERIFIABL_REF_A }]);
  });

  it("rejects records with a malformed Verifiabl reference before sending", async () => {
    const fetch = mockFetch(200, { results: [] });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(
      client.registerNonPiiBatch({
        records: [{ ...REQUEST, verifiablReference: "too-short" }],
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty batch before sending", async () => {
    const fetch = mockFetch(200, { results: [] });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    await expect(client.registerNonPiiBatch({ records: [] })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects batches above the API maximum before sending", async () => {
    const fetch = mockFetch(200, { results: [] });
    const client = new VerifiablClient({ ...STATIC_AUTH, fetch });

    const records = Array.from({ length: 1001 }, () => ({
      ...REQUEST,
      verifiablReference: VERIFIABL_REF_A,
    }));
    await expect(client.registerNonPiiBatch({ records })).rejects.toThrow();
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
        url.includes("registerAndBuildBarcode")
          ? registerAndBuildBarcodeResponse()
          : registerResponse(),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await client.registerNonPii(REQUEST);
    await client.registerAndBuildBarcode(REGISTER_AND_BUILD_BARCODE_REQUEST);

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
        url.includes("registerAndBuildBarcode")
          ? registerAndBuildBarcodeResponse()
          : registerResponse(),
    });
    const client = new VerifiablClient({ auth: OAUTH, fetch });

    await client.registerNonPii(REQUEST);
    await client.registerAndBuildBarcode(REGISTER_AND_BUILD_BARCODE_REQUEST);

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

    expect(result.verifiablReference).toBe(VERIFIABL_REF);
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
