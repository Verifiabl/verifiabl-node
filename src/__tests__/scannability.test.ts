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

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv";
const FIXTURE_KEY = Buffer.alloc(32, 7);
const MIN_TESTED_RASTER_WIDTH = 480;
// Geometry pixel-sampling renders at a fixed raster size independent of the
// badge width; the sampled coordinates below assume this 420px raster.
const GEOMETRY_RASTER_WIDTH = 420;
const BADGE_VIEWBOX_WIDTH = 96;
const BADGE_VIEWBOX_HEIGHT = 150;
// The documented placement rule: a light host with a clear margin of a tenth
// of the badge width on the left, right and bottom (the QR quiet zone).
const HOST_MARGIN_UNITS = BADGE_VIEWBOX_WIDTH / 10;

const DOCS_EXAMPLE_FIELDS = {
  employeeName: "Jane A. Doe",
  position: "Senior Developer",
  department: "Engineering",
  employerAbn: "12-345-678-901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Jane A Doe",
  address: "12 Example St, Sydney NSW 2000",
} satisfies PiiFields;

const LONG_NAME_FIELDS = {
  employeeName: "Dr. Jane Alexandra Catherine Doe-Smith-Washington Nguyen",
  position: "Senior Principal Software Engineering Manager",
  department: "Engineering, Platform and Infrastructure",
  employerAbn: "12-345-678-901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Jane Alexandra Catherine Doe Smith Washington Nguyen",
  address: "88 Harrington Street, Sydney NSW 2000",
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
      employeeName: "Aoife Ní Bhraonáin",
      position: "Software Engineer",
      department: "Platform",
      employerAbn: "51-824-753-556",
      bsb: "083-004",
      accountNumber: "55512345",
      accountName: "Aoife Ni Bhraonain",
    },
  },
  {
    label: "Spanish, compound surname",
    fields: {
      employeeName: "José María García-López",
      position: "Registered Nurse",
      department: "Aged Care",
      employerAbn: "33-051-775-556",
      bsb: "062-001",
      accountNumber: "10293847",
      accountName: "Jose M Garcia Lopez",
    },
  },
  {
    label: "Vietnamese, diacritics",
    fields: {
      employeeName: "Nguyễn Thị Minh Khai",
      position: "Regional Manager",
      department: "Sales & Marketing",
      employerAbn: "29-002-589-460",
      bsb: "923-100",
      accountNumber: "44556677",
      accountName: "Nguyen T M Khai",
    },
  },
  {
    label: "Chinese, CJK glyphs",
    fields: {
      employeeName: "Wei Zhang (张伟)",
      position: "Site Supervisor",
      department: "Construction",
      employerAbn: "11-004-447-790",
      bsb: "013-006",
      accountNumber: "98761234",
      accountName: "Wei Zhang",
    },
  },
  {
    label: "Yoruba, accented",
    fields: {
      employeeName: "Olúwáségun Adébáyò",
      position: "Data Analyst",
      department: "Insights & Reporting",
      employerAbn: "72-629-770-111",
      bsb: "484-799",
      accountNumber: "11224455",
      accountName: "Oluwasegun Adebayo",
    },
  },
  {
    label: "German, long compound",
    fields: {
      employeeName: "Maximilian von Habsburg-Lothringen",
      position: "Apprentice Electrician",
      department: "Trades",
      employerAbn: "60-008-661-002",
      bsb: "036-002",
      accountNumber: "33445566",
      accountName: "M von Habsburg-Lothringen",
    },
  },
  {
    label: "Arabic, transliterated",
    fields: {
      employeeName: "Fatima Al-Sayed",
      position: "Operations Lead",
      department: "Logistics",
      employerAbn: "45-110-892-340",
      bsb: "112-879",
      accountNumber: "77889900",
      accountName: "Fatima Al-Sayed",
    },
  },
  {
    label: "Māori, macrons",
    fields: {
      employeeName: "Tāne Whakaari-Ngata",
      position: "Finance Director",
      department: "Finance",
      employerAbn: "98-771-203-884",
      bsb: "021-000",
      accountNumber: "12309876",
      accountName: "Tane Whakaari Ngata",
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
      verifiablReference: VERIFIABL_REF,
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
 * Place the badge on a host page the way the docs require: a light ground with
 * the quiet-zone margin around it. The badge is transparent outside the header
 * and the QR modules and the QR spans its full width, so the host, not the
 * badge, supplies the quiet zone on the left, right and bottom.
 */
function placeOnHostPage(svg: string, background = "#FFFFFF"): string {
  const badgeElement = svg.replace(
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+" height="[\d.]+" /,
    `<svg x="${HOST_MARGIN_UNITS}" width="${BADGE_VIEWBOX_WIDTH}" height="${BADGE_VIEWBOX_HEIGHT}" `,
  );
  if (badgeElement === svg) {
    throw new Error("badge SVG opening tag did not match");
  }
  const width = BADGE_VIEWBOX_WIDTH + 2 * HOST_MARGIN_UNITS;
  const height = BADGE_VIEWBOX_HEIGHT + HOST_MARGIN_UNITS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>${badgeElement}</svg>`
  );
}

/** Raster width of the host page at which the badge itself is `badgeRasterWidth` wide. */
function hostRasterWidth(badgeRasterWidth: number): number {
  return Math.round(
    (badgeRasterWidth * (BADGE_VIEWBOX_WIDTH + 2 * HOST_MARGIN_UNITS)) / BADGE_VIEWBOX_WIDTH,
  );
}

/** Decode the badge placed on a white host page with the documented margin. */
function decode(parts: BarcodeParts, options: BarcodeSvgOptions = {}, rasterWidth = 900): string {
  return decodePixels(
    placeOnHostPage(createBarcodeSvg(parts, options).svg),
    hostRasterWidth(rasterWidth),
  );
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

  it("leaves the ground transparent outside the header and the QR", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const transparent = { r: 0, g: 0, b: 0, a: 0 };
    // The header's rounded top corners, and the gap between header and QR
    // (47u to 54u; sampled at 50.5u) across the full width.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 0)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 0)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 221)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 210, 221)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 221)).toEqual(transparent);
    // Header stays navy.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 40, 20)).toEqual({
      r: 1,
      g: 10,
      b: 79,
      a: 255,
    });
  });

  it("spans the full badge width: the QR reaches both edges of a realistic record", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const black = { r: 0, g: 0, b: 0, a: 255 };
    // The top-left and top-right finder rings sit flush with the badge edges:
    // sample one module in from each corner at the ring's vertical centre line.
    // The QR box starts at 54u; the finder ring is 7 modules and ~1.6u/module.
    const ringCentreY = Math.round(((54 + 1.6 * 3.5) * GEOMETRY_RASTER_WIDTH) / 96);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 2, ringCentreY)).toEqual(black);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 417, ringCentreY)).toEqual(black);
  });

  it("depends on the host for the quiet zone: a dark host defeats the scan", () => {
    // The badge carries no white body any more, so the documented placement
    // (light ground, clear margin) is load-bearing. Prove the contract both
    // ways: white host decodes, a navy full-bleed host does not.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg, content } = createBarcodeSvg(parts);
    const width = hostRasterWidth(MIN_TESTED_RASTER_WIDTH);
    expect(decodePixels(placeOnHostPage(svg), width)).toBe(content);
    expect(() => decodePixels(placeOnHostPage(svg, "#010A4F"), width)).toThrow(
      /could not be decoded/,
    );
  });

  it("decoded URL round-trips to the original payload", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const scanned = new URL(decode(parts));
    const reference = scanned.pathname.slice(scanned.pathname.lastIndexOf("/") + 1);
    const ciphertext = scanned.hash.slice("#2.".length);

    expect(`2|${reference}|${ciphertext}`).toBe(buildBarcodePayload(parts));
  });

  it("decodes the mixed-mode v2 symbol byte-exactly", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const expected = createBarcodeSvg(parts);
    const scanned = decode(parts, {}, MIN_TESTED_RASTER_WIDTH);

    expect(scanned).toBe(expected.content);
    expect(scanned).toMatch(/^https:\/\/v\.verifiabl\.io\/v\/[A-Za-z0-9_-]{22}#2\.[A-Z2-7]+$/);
    expect(expected.errorCorrectionLevel).toBe("M");
    expect(expected.qrVersion).toBeGreaterThan(0);
  });

  it("decodes the encrypted docs PII example at the minimum raster width", () => {
    const { parts, plaintext } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    expect(plaintext).toBe(
      "P2|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe|12 Example St, Sydney NSW 2000",
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

  it("defaults to error-correction M and renders a clean (non-degraded) code", () => {
    // The default ceiling is M, not Q: a realistic record is one or two QR
    // versions smaller (larger modules) than under Q, and not flagged degraded.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const result = createBarcodeSvg(parts);
    expect(result.errorCorrectionLevel).toBe("M");
    expect(result.degraded).toBe(false);
  });

  it("maxErrorCorrection 'Q' stays available and yields a denser code", () => {
    // Opting back into Q packs the same payload into more (smaller) modules for
    // extra damage recovery; both encodings remain scannable and non-degraded.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const defaultResult = createBarcodeSvg(parts);
    const qResult = createBarcodeSvg(parts, { maxErrorCorrection: "Q" });
    expect(qResult.errorCorrectionLevel).toBe("Q");
    expect(qResult.degraded).toBe(false);
    // Denser: Q's modules are smaller than the default M's at the same width.
    expect(qResult.modulePx).toBeLessThan(defaultResult.modulePx);
    expect(decode(parts, { maxErrorCorrection: "Q" })).toBe(qResult.content);
  });

  // The ladder degrades error correction (not the frame) for unusually long
  // PII. The degraded code keeps the fixed frame size and stays scannable when
  // rendered at a realistic resolution. (Decoding at exactly 1:1 is a pixel-grid
  // aliasing artifact, not a real-world scan condition, so we rasterise at 2x to
  // represent any normal-DPI render or camera capture.) Expectations follow the
  // default "M" ceiling: the code stays at M (sub-ideal modules flag degraded)
  // until even M won't fit, then drops to L.
  const REALISTIC_SCAN_RASTER = MIN_TESTED_RASTER_WIDTH * 2;
  it.each([
    { label: "stays M, sub-ideal modules", plaintext: `P1|${"A".repeat(800)}`, ec: "M" },
    { label: "stays M near the floor", plaintext: `P1|${"A".repeat(1200)}`, ec: "M" },
    { label: "drops to L", plaintext: `P1|${"A".repeat(1400)}`, ec: "L" },
  ])("decodes a $label record at the fixed frame and flags it degraded", ({ plaintext, ec }) => {
    const parts: BarcodeParts = {
      verifiablReference: VERIFIABL_REF,
      encryptedPii: encryptFixture(plaintext),
    };
    const result = createBarcodeSvg(parts, { format: "v1" });
    expect(result.errorCorrectionLevel).toBe(ec);
    expect(result.degraded).toBe(true);
    expect(result.width).toBe(480);
    expect(decode(parts, { format: "v1" }, REALISTIC_SCAN_RASTER)).toBe(result.content);
  });

  it("hard-errors when PII cannot fit the fixed frame even degraded to L", () => {
    const parts: BarcodeParts = {
      verifiablReference: VERIFIABL_REF,
      encryptedPii: encryptFixture(`P1|${"A".repeat(1900)}`),
    };
    expect(() => createBarcodeSvg(parts, { format: "v1" })).toThrow(
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
