import { createCipheriv, createHash } from "node:crypto";
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
const MIN_TESTED_RASTER_WIDTH = 480;
// Geometry pixel-sampling renders at a fixed raster size independent of the
// badge width; the sampled coordinates below assume this 420px raster.
const GEOMETRY_RASTER_WIDTH = 420;

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

/**
 * A spread of real-world names, roles, departments, and account names
 * (accented, hyphenated, transliterated, and CJK characters) to prove styling
 * holds machine readability across the variety of PII issuers actually emit,
 * all at the minimum raster width.
 */
const DIVERSE_RECORDS: ReadonlyArray<{ label: string; fields: PiiFields }> = [
  {
    label: "Irish, accented",
    fields: {
      employee_name: "Aoife Ní Bhraonáin",
      position: "Software Engineer",
      department: "Platform",
      employer_abn: "51-824-753-556",
      bsb: "083-004",
      account_number: "55512345",
      account_name: "Aoife Ni Bhraonain",
    },
  },
  {
    label: "Spanish, compound surname",
    fields: {
      employee_name: "José María García-López",
      position: "Registered Nurse",
      department: "Aged Care",
      employer_abn: "33-051-775-556",
      bsb: "062-001",
      account_number: "10293847",
      account_name: "Jose M Garcia Lopez",
    },
  },
  {
    label: "Vietnamese, diacritics",
    fields: {
      employee_name: "Nguyễn Thị Minh Khai",
      position: "Regional Manager",
      department: "Sales & Marketing",
      employer_abn: "29-002-589-460",
      bsb: "923-100",
      account_number: "44556677",
      account_name: "Nguyen T M Khai",
    },
  },
  {
    label: "Chinese, CJK glyphs",
    fields: {
      employee_name: "Wei Zhang (张伟)",
      position: "Site Supervisor",
      department: "Construction",
      employer_abn: "11-004-447-790",
      bsb: "013-006",
      account_number: "98761234",
      account_name: "Wei Zhang",
    },
  },
  {
    label: "Yoruba, accented",
    fields: {
      employee_name: "Olúwáségun Adébáyò",
      position: "Data Analyst",
      department: "Insights & Reporting",
      employer_abn: "72-629-770-111",
      bsb: "484-799",
      account_number: "11224455",
      account_name: "Oluwasegun Adebayo",
    },
  },
  {
    label: "German, long compound",
    fields: {
      employee_name: "Maximilian von Habsburg-Lothringen",
      position: "Apprentice Electrician",
      department: "Trades",
      employer_abn: "60-008-661-002",
      bsb: "036-002",
      account_number: "33445566",
      account_name: "M von Habsburg-Lothringen",
    },
  },
  {
    label: "Arabic, transliterated",
    fields: {
      employee_name: "Fatima Al-Sayed",
      position: "Operations Lead",
      department: "Logistics",
      employer_abn: "45-110-892-340",
      bsb: "112-879",
      account_number: "77889900",
      account_name: "Fatima Al-Sayed",
    },
  },
  {
    label: "Māori, macrons",
    fields: {
      employee_name: "Tāne Whakaari-Ngata",
      position: "Finance Director",
      department: "Finance",
      employer_abn: "98-771-203-884",
      bsb: "021-000",
      account_number: "12309876",
      account_name: "Tane Whakaari Ngata",
    },
  },
] as const;

function encryptFixture(plaintext: string): string {
  // Derive a unique IV per plaintext so distinct fixtures never reuse an
  // IV under the same key (the real AES-GCM footgun), while staying
  // deterministic for reproducible tests. Production uses a random IV.
  const iv = createHash("sha256").update(plaintext).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", FIXTURE_KEY, iv);
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

function decodePixels(svg: string, rasterWidth: number): string {
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: rasterWidth } }).render();
  const result = jsQR.default(
    new Uint8ClampedArray(rendered.pixels),
    rendered.width,
    rendered.height,
  );
  if (!result) throw new Error(`QR code could not be decoded at ${rasterWidth}px`);
  return result.data;
}

/**
 * Decode the badge exactly as emitted. The white frame body is part of the
 * SVG, so scannability must not depend on any injected background.
 */
function decode(parts: BarcodeParts, options: BarcodeSvgOptions = {}, rasterWidth = 900): string {
  return decodePixels(createBarcodeSvg(parts, options).svg, rasterWidth);
}

/**
 * Composite the badge over a hostile full-bleed document background. The
 * white body should still protect the QR, so this must decode regardless of
 * what the payslip places behind the badge.
 */
function decodeOnDocumentBackground(
  parts: BarcodeParts,
  background: string,
  rasterWidth = MIN_TESTED_RASTER_WIDTH,
): string {
  const { svg } = createBarcodeSvg(parts);
  const openingTagEnd = svg.indexOf(">");
  if (openingTagEnd < 0) {
    throw new Error("SVG opening tag was not found");
  }
  const composited = `${svg.slice(0, openingTagEnd + 1)}<rect width="96" height="151" fill="${background}"/>${svg.slice(
    openingTagEnd + 1,
  )}`;
  return decodePixels(composited, rasterWidth);
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

  it("fills the frame body white around the QR (the quiet zone)", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const white = { r: 255, g: 255, b: 255, a: 255 };
    // Above the QR (below the header), both side gutters, and below the QR.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 210, 232)).toEqual(white);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 17, 437)).toEqual(white);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 402, 437)).toEqual(white);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 210, 630)).toEqual(white);
  });

  it("keeps the rounded corners transparent and the header navy", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const transparent = { r: 0, g: 0, b: 0, a: 0 };
    // All four corners fall outside the rounded frame body.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 0)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 0)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 659)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 659)).toEqual(transparent);
    // Header stays navy.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 40, 20)).toEqual({
      r: 1,
      g: 10,
      b: 79,
      a: 255,
    });
  });

  it("decodes even over a hostile full-bleed document background", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { content } = createBarcodeSvg(parts);
    // Dark navy and mid-grey would defeat a transparent quiet zone; the white
    // body keeps the QR readable regardless of the host document.
    expect(decodeOnDocumentBackground(parts, "#010A4F")).toBe(content);
    expect(decodeOnDocumentBackground(parts, "#888888")).toBe(content);
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

  it.each(
    DIVERSE_RECORDS,
  )("decodes a diverse real-world record at the minimum raster width ($label)", ({ fields }) => {
    const { parts } = partsFromPii(fields);
    expect(decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  // The damage-first ladder degrades error correction (not the frame) for
  // unusually long PII. The degraded code keeps the fixed frame size and stays
  // scannable when rendered at a realistic resolution. (Decoding at exactly 1:1
  // is a pixel-grid aliasing artifact, not a real-world scan condition, so we
  // rasterise at 2x to represent any normal-DPI render or camera capture.)
  const REALISTIC_SCAN_RASTER = MIN_TESTED_RASTER_WIDTH * 2;
  it.each([
    { label: "degraded Q", plaintext: `P1|${"A".repeat(500)}`, ec: "Q" },
    { label: "drops to M", plaintext: `P1|${"A".repeat(800)}`, ec: "M" },
    { label: "drops to L", plaintext: `P1|${"A".repeat(1000)}`, ec: "L" },
  ])("decodes a $label record at the fixed frame and flags it degraded", ({ plaintext, ec }) => {
    const parts: BarcodeParts = {
      linkingToken: LINKING_TOKEN,
      encryptedPii: encryptFixture(plaintext),
    };
    const result = createBarcodeSvg(parts);
    expect(result.errorCorrectionLevel).toBe(ec);
    expect(result.degraded).toBe(true);
    expect(result.width).toBe(480);
    expect(decode(parts, {}, REALISTIC_SCAN_RASTER)).toBe(result.content);
  });

  it("hard-errors when PII cannot fit the fixed frame even degraded to L", () => {
    const parts: BarcodeParts = {
      linkingToken: LINKING_TOKEN,
      encryptedPii: encryptFixture(`P1|${"A".repeat(1200)}`),
    };
    expect(() => createBarcodeSvg(parts)).toThrow(
      /too long to render a scannable barcode in the branded frame/,
    );
  });

  it("decodes the framed badge across larger raster scales", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { content } = createBarcodeSvg(parts);
    for (const rasterWidth of [500, 900, 1600]) {
      expect(decode(parts, {}, rasterWidth)).toBe(content);
    }
  });
});
