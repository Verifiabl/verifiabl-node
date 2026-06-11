import { VerifiablApiError, VerifiablClient } from "../client.js";
import { buildScanUrl } from "../payload.js";
import type { CreateBarcodeRequest, RegisterNonPiiRequest } from "../types.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv";
const CT = "Zm9v";
const PAYLOAD = `1|${LT}|${CT}`;

const REQUEST: RegisterNonPiiRequest = {
  schema: "au.payslip.v1",
  issued_at: "2026-06-11T00:00:00Z",
  payslip_data: { period_start: "2026-05-01", period_end: "2026-05-31", gross: "9000.00" },
  encryption_metadata: { iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA", key_version: "v1" },
};

const CREATE_BARCODE_REQUEST: CreateBarcodeRequest = {
  ...REQUEST,
  encrypted_pii: CT,
};

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

describe("VerifiablClient", () => {
  it("requires an apiKey", () => {
    expect(() => new VerifiablClient({ apiKey: "" })).toThrow("apiKey is required");
  });

  it("rejects non-https base URLs except local http development", () => {
    expect(() => new VerifiablClient({ apiKey: "k", baseUrl: "http://api.example" })).toThrow(
      "https",
    );
    expect(() => new VerifiablClient({ apiKey: "k", baseUrl: "file://localhost/tmp" })).toThrow(
      "https",
    );
  });

  it("allows http for loopback development", () => {
    expect(
      () => new VerifiablClient({ apiKey: "k", baseUrl: "http://localhost:3001" }),
    ).not.toThrow();
    expect(
      () => new VerifiablClient({ apiKey: "k", baseUrl: "http://127.0.0.1:3001" }),
    ).not.toThrow();
    expect(() => new VerifiablClient({ apiKey: "k", baseUrl: "http://[::1]:3001" })).not.toThrow();
  });

  it("rejects invalid timeouts", () => {
    expect(() => new VerifiablClient({ apiKey: "k", timeoutMs: 0 })).toThrow("timeoutMs");
  });

  it("sends bearer auth and JSON body to the right path", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: "AbCdEfGhIjKlMnOpQrStUv" });
    const client = new VerifiablClient({
      apiKey: "secret-key",
      fetch,
    });

    const result = await client.registerNonPii(REQUEST);

    expect(result.linking_token).toBe("AbCdEfGhIjKlMnOpQrStUv");
    const [url, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    expect(url).toBe("https://api.verifiabl.io/v1/registerNonPII");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-key");
    const parsedBody: unknown = JSON.parse(String(init.body));
    expect(parsedBody).toEqual(REQUEST);
  });

  it("throws VerifiablApiError with the stable code on API errors", async () => {
    const fetch = mockFetch(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    const client = new VerifiablClient({
      apiKey: "bad-key",
      fetch,
    });

    await expect(client.registerNonPii(REQUEST)).rejects.toMatchObject({
      name: "VerifiablApiError",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("maps API symbols to barcode images for createBarcode", async () => {
    const fetch = mockFetch(201, {
      id: "barcode-record",
      symbol: {
        format: "png",
        data: "iVBORw0KGgo=",
        width_px: 720,
        height_px: 720,
      },
    });
    const client = new VerifiablClient({
      apiKey: "k",
      fetch,
    });

    const result = await client.createBarcode(CREATE_BARCODE_REQUEST);

    expect(result).toEqual({
      id: "barcode-record",
      barcode: {
        format: "png",
        data: "iVBORw0KGgo=",
        width_px: 720,
        height_px: 720,
      },
    });
    const [url, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    expect(url).toBe("https://api.verifiabl.io/v1/registerAndBuildSymbol");
    const parsedBody: unknown = JSON.parse(String(init.body));
    expect(parsedBody).toEqual(CREATE_BARCODE_REQUEST);
  });

  it("survives non-JSON error bodies", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      return new Response("not json", { status: 502 });
    });
    const client = new VerifiablClient({
      apiKey: "k",
      fetch: fetchMock,
    });

    let error: unknown;
    try {
      await client.verifyBarcode({ barcode: PAYLOAD });
    } catch (err) {
      error = err;
    }
    if (!(error instanceof VerifiablApiError)) {
      throw new Error("Expected VerifiablApiError");
    }
    expect(error.status).toBe(502);
  });

  it("routes verifyBarcode to /v1/verifications/payload", async () => {
    const fetch = mockFetch(200, {
      verified: true,
      linking_token: "AbCdEfGhIjKlMnOpQrStUv",
      payslip: {},
      employee: { employee_name: "Jane A. Doe" },
      decrypted_at: "2026-06-11T00:00:00Z",
    });
    const client = new VerifiablClient({
      apiKey: "k",
      fetch,
    });

    const result = await client.verifyBarcode({ lt: LT, ct: CT });
    expect(result.verified).toBe(true);
    const [url] = firstFetchCall(fetch);
    expect(url).toBe("https://api.verifiabl.io/v1/verifications/payload");
  });

  it("normalises scan URLs before verifying a barcode", async () => {
    const fetch = mockFetch(200, {
      verified: true,
      linking_token: LT,
      payslip: {},
      employee: {},
      decrypted_at: "2026-06-11T00:00:00Z",
    });
    const client = new VerifiablClient({ apiKey: "k", fetch });

    await client.verifyBarcode({
      barcode: ` ${buildScanUrl({ linkingToken: LT, encryptedPii: CT })} `,
    });

    const [, init] = firstFetchCall(fetch);
    if (init === undefined) {
      throw new Error("Expected fetch init options");
    }
    const parsedBody: unknown = JSON.parse(String(init.body));
    expect(parsedBody).toEqual({ barcode: PAYLOAD });
  });

  it("validates request bodies before sending", async () => {
    const fetch = mockFetch(201, { id: "x", linking_token: "AbCdEfGhIjKlMnOpQrStUv" });
    const client = new VerifiablClient({ apiKey: "k", fetch });
    await expect(client.verifyBarcode({ lt: "too-short", ct: "Zm9v" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
