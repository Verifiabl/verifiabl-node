import {
  buildBarcodePayload,
  buildScanUrl,
  DEFAULT_VERIFIER_BASE_URL,
  extractPayloadFromScan,
} from "../payload.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv"; // 22 base64url chars
const CT = "Zm9vYmFyYmF6cXV4";

describe("buildBarcodePayload", () => {
  it("builds the v1 pipe format", () => {
    expect(buildBarcodePayload({ linkingToken: LT, encryptedPii: CT })).toBe(`1|${LT}|${CT}`);
  });

  it("rejects linking tokens that are not 22 chars", () => {
    expect(() => buildBarcodePayload({ linkingToken: "short", encryptedPii: CT })).toThrow();
  });

  it("rejects non-base64url ciphertext", () => {
    expect(() => buildBarcodePayload({ linkingToken: LT, encryptedPii: "not+valid/" })).toThrow();
  });

  it("rejects empty ciphertext", () => {
    expect(() => buildBarcodePayload({ linkingToken: LT, encryptedPii: "" })).toThrow();
  });
});

describe("buildScanUrl", () => {
  it("wraps the payload in the production /v/ URL with URL encoding", () => {
    const url = buildScanUrl({ linkingToken: LT, encryptedPii: CT });
    expect(url).toBe(`${DEFAULT_VERIFIER_BASE_URL}/v/${encodeURIComponent(`1|${LT}|${CT}`)}`);
    expect(url).toContain("%7C"); // pipes must be encoded
  });

  it("accepts a custom https base URL", () => {
    const url = buildScanUrl(
      { linkingToken: LT, encryptedPii: CT },
      { baseUrl: "https://api.sandbox.verifiabl.io" },
    );
    expect(url.startsWith("https://api.sandbox.verifiabl.io/v/")).toBe(true);
  });

  it("rejects http base URLs", () => {
    expect(() =>
      buildScanUrl({ linkingToken: LT, encryptedPii: CT }, { baseUrl: "http://evil.example" }),
    ).toThrow("https");
  });
});

describe("extractPayloadFromScan", () => {
  it("round-trips a scan URL back to the bare payload", () => {
    const url = buildScanUrl({ linkingToken: LT, encryptedPii: CT });
    expect(extractPayloadFromScan(url)).toBe(`1|${LT}|${CT}`);
  });

  it("passes through bare payloads", () => {
    expect(extractPayloadFromScan(`1|${LT}|${CT}`)).toBe(`1|${LT}|${CT}`);
  });

  it("rejects unrecognised input", () => {
    expect(() => extractPayloadFromScan("hello world")).toThrow("Unrecognised scan format");
  });
});
