import { BarcodeParseError, parseBarcode } from "../parse.js";
import { buildBarcodePayload, buildScanUrl } from "../payload.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv"; // 22 base64url chars
const CIPHERTEXT = "Zm9vYmFyYmF6cXV4";
const PARTS = { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT };

describe("parseBarcode", () => {
  it("parses the bare v1 pipe payload", () => {
    expect(parseBarcode(`1|${VERIFIABL_REF}|${CIPHERTEXT}`)).toEqual(PARTS);
  });

  it("round-trips buildBarcodePayload", () => {
    expect(parseBarcode(buildBarcodePayload(PARTS))).toEqual(PARTS);
  });

  it("round-trips buildScanUrl for production and sandbox", () => {
    expect(parseBarcode(buildScanUrl(PARTS))).toEqual(PARTS);
    expect(parseBarcode(buildScanUrl(PARTS, { environment: "sandbox" }))).toEqual(PARTS);
  });

  it("parses the JSON wire form (snake_case keys)", () => {
    const json = JSON.stringify({
      v: 1,
      verifiabl_reference: VERIFIABL_REF,
      ciphertext: CIPHERTEXT,
    });
    expect(parseBarcode(json)).toEqual(PARTS);
  });

  it("parses a scan URL on any verifiabl.io subdomain", () => {
    const payload = encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
    expect(parseBarcode(`https://verify.sandbox.verifiabl.io/v/${payload}`)).toEqual(PARTS);
    expect(parseBarcode(`https://verifiabl.io/v/${payload}`)).toEqual(PARTS);
  });

  it("rejects http scan URLs", () => {
    const payload = encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
    expect(() => parseBarcode(`http://verify.verifiabl.io/v/${payload}`)).toThrow(
      BarcodeParseError,
    );
  });

  it("rejects off-domain scan URLs", () => {
    const payload = encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
    expect(() => parseBarcode(`https://evil.example/v/${payload}`)).toThrow(BarcodeParseError);
  });

  it("rejects hostnames that merely contain verifiabl.io", () => {
    const payload = encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
    expect(() => parseBarcode(`https://verifiabl.io.evil.example/v/${payload}`)).toThrow(
      BarcodeParseError,
    );
  });

  it("rejects scan URLs without the /v/ path", () => {
    const payload = encodeURIComponent(`1|${VERIFIABL_REF}|${CIPHERTEXT}`);
    expect(() => parseBarcode(`https://verify.verifiabl.io/x/${payload}`)).toThrow(
      BarcodeParseError,
    );
  });

  it("rejects scan URLs with an empty payload segment", () => {
    expect(() => parseBarcode("https://verify.verifiabl.io/v/")).toThrow(BarcodeParseError);
  });

  it("rejects a pipe payload with the wrong number of parts", () => {
    expect(() => parseBarcode(`1|${VERIFIABL_REF}`)).toThrow(
      "Invalid v1 barcode: expected format 1|<verifiablReference>|<ciphertext>",
    );
    expect(() => parseBarcode(`1|${VERIFIABL_REF}|${CIPHERTEXT}|extra`)).toThrow(BarcodeParseError);
  });

  it("rejects JSON missing the required fields", () => {
    expect(() => parseBarcode(JSON.stringify({ verifiabl_reference: VERIFIABL_REF }))).toThrow(
      "JSON barcode must contain verifiabl_reference and ciphertext fields",
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => parseBarcode("{not json")).toThrow(
      "Barcode looks like JSON but could not be parsed",
    );
  });

  it("rejects an invalid Verifiabl reference recovered from a payload", () => {
    expect(() => parseBarcode(`1|too-short|${CIPHERTEXT}`)).toThrow(
      "Verifiabl reference must be exactly 22 base64url characters",
    );
  });

  it("rejects non-base64url ciphertext", () => {
    expect(() => parseBarcode(`1|${VERIFIABL_REF}|not+base64url!`)).toThrow(
      "Ciphertext must be base64url encoded",
    );
  });

  it("rejects empty input", () => {
    expect(() => parseBarcode("")).toThrow("Barcode text is required");
  });

  it("rejects oversized input", () => {
    expect(() => parseBarcode(`1|${VERIFIABL_REF}|${"A".repeat(11_001)}`)).toThrow(
      "Barcode text exceeds maximum allowed length",
    );
  });

  it("rejects text that matches no known format", () => {
    expect(() => parseBarcode("hello world")).toThrow("Unrecognised barcode format");
  });
});
