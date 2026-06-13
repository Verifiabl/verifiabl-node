import { createCipheriv } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

import jsQR = require("jsqr");

import { type BarcodeParts, buildBarcodePayload } from "../payload.js";
import { formatPii, type PiiFields } from "../pii.js";
import { type BarcodeSvgOptions, createBarcodeSvg } from "../qr/styled.js";

/**
 * End-to-end scannability: rasterise the styled SVG and decode it with an
 * independent QR reader. This is the SDK's core promise: styling must
 * never break machine readability.
 */

const LINKING_TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const FIXTURE_KEY = Buffer.alloc(32, 7);
const FIXTURE_IV = Buffer.alloc(12, 3);
const MIN_TESTED_RASTER_WIDTH = 420;

const DOCS_EXAMPLE_FIELDS = {
  employee_name: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "Jane A Doe",
} satisfies PiiFields;

const LONG_NAME_FIELDS = {
  employee_name: "Dr. Jane Alexandra Catherine Doe-Smith-Washington Nguyen",
  position: "Senior Principal Software Engineering Manager",
  department: "Engineering, Platform and Infrastructure",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "Jane Alexandra Catherine Doe Smith Washington Nguyen",
} satisfies PiiFields;

const MAX_LENGTH_NAME_FIELDS = {
  employee_name: "A".repeat(256),
  position: "Senior Developer",
  department: "Engineering",
  employer_abn: "12-345-678-901",
  bsb: "062-000",
  account_number: "12345678",
  account_name: "A".repeat(256),
} satisfies PiiFields;

function encryptFixture(plaintext: string): string {
  const cipher = createCipheriv("aes-256-gcm", FIXTURE_KEY, FIXTURE_IV);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64url");
}

function partsFromPii(fields: PiiFields): { parts: BarcodeParts; plaintext: string } {
  const plaintext = formatPii(fields);
  return {
    parts: {
      linkingToken: LINKING_TOKEN,
      encryptedPii: encryptFixture(plaintext),
    },
    plaintext,
  };
}

function decode(parts: BarcodeParts, options: BarcodeSvgOptions = {}, rasterWidth = 900): string {
  const { svg } = createBarcodeSvg(parts, options);
  const rendered = new Resvg(withDocumentBackground(svg), {
    fitTo: { mode: "width", value: rasterWidth },
  }).render();
  const result = jsQR.default(
    new Uint8ClampedArray(rendered.pixels),
    rendered.width,
    rendered.height,
  );
  if (!result) throw new Error(`QR code could not be decoded at ${rasterWidth}px`);
  return result.data;
}

function withDocumentBackground(svg: string): string {
  const openingTagEnd = svg.indexOf(">");
  if (openingTagEnd < 0) {
    throw new Error("SVG opening tag was not found");
  }
  return `${svg.slice(0, openingTagEnd + 1)}<rect width="96" height="151" fill="#FFFFFF"/>${svg.slice(
    openingTagEnd + 1,
  )}`;
}

function sampleRenderedPixel(
  svg: string,
  rasterWidth: number,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: rasterWidth } }).render();
  const index = (y * rendered.width + x) * 4;
  return {
    r: pixelChannel(rendered.pixels, index),
    g: pixelChannel(rendered.pixels, index + 1),
    b: pixelChannel(rendered.pixels, index + 2),
    a: pixelChannel(rendered.pixels, index + 3),
  };
}

function pixelChannel(pixels: Uint8Array, index: number): number {
  const value = pixels[index];
  if (value === undefined) {
    throw new Error(`Rendered pixel index ${index} is out of bounds`);
  }
  return value;
}

describe("styled QR scannability", () => {
  it("decodes the framed badge back to the scan URL", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    expect(decode(parts)).toBe(createBarcodeSvg(parts).content);
  });

  it("leaves the frame body transparent outside the header, border, and QR", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const bodyPixel = sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 30, 230);
    expect(bodyPixel).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("keeps the rounded header corners transparent", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    expect(sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 0, 0)).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 419, 0)).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 40, 20)).toEqual({
      r: 1,
      g: 10,
      b: 79,
      a: 255,
    });
  });

  it("leaves the QR quiet zone transparent", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const quietZonePixel = sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 40, 375);
    expect(quietZonePixel).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("keeps clear space between the QR and lower rounded frame", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const lowerBodyPixel = sampleRenderedPixel(svg, MIN_TESTED_RASTER_WIDTH, 210, 620);
    expect(lowerBodyPixel).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("decoded URL round-trips to the original payload", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const scanned = decode(parts);
    const encodedPayload = scanned.slice(scanned.lastIndexOf("/") + 1);
    expect(decodeURIComponent(encodedPayload)).toBe(buildBarcodePayload(parts));
  });

  it("decodes the encrypted docs PII example at the minimum raster width", () => {
    const { parts, plaintext } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    expect(plaintext).toBe(
      "P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe",
    );
    expect(parts.encryptedPii.length).toBeGreaterThan(plaintext.length);
    expect(decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  it("decodes longer real-world employee fields at the minimum raster width", () => {
    const { parts, plaintext } = partsFromPii(LONG_NAME_FIELDS);
    expect(plaintext.length).toBeGreaterThan(formatPii(DOCS_EXAMPLE_FIELDS).length);
    expect(parts.encryptedPii.length).toBeGreaterThan(plaintext.length);
    expect(decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  it("decodes maximum allowed name fields at the minimum raster width", () => {
    const { parts, plaintext } = partsFromPii(MAX_LENGTH_NAME_FIELDS);
    expect(plaintext.length).toBeGreaterThan(formatPii(LONG_NAME_FIELDS).length);
    expect(parts.encryptedPii.length).toBeGreaterThan(plaintext.length);
    expect(decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  it("decodes the framed badge across larger raster scales", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { content } = createBarcodeSvg(parts);
    for (const rasterWidth of [500, 900, 1600]) {
      expect(decode(parts, {}, rasterWidth)).toBe(content);
    }
  });
});
