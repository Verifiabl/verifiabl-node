import { createCipheriv, createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

import { type BarcodeParts, buildBarcodePayload } from "../payload.js";
import { type AustralianPiiFields, formatAustralianPii } from "../pii.js";
import { type BarcodeSvgOptions, createBarcodeSvg } from "../qr/styled.js";
import { decodeQrImage } from "../test/decodeQr.js";

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
  employeeName: "Ana Leota",
  position: "Senior Developer",
  department: "Engineering",
  employerAbn: "12-345-678-901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "A Leota",
  address: {
    lines: ["12 Example St"],
    suburb: "Sydney",
    stateOrTerritory: "NSW",
    postcode: "2000",
  },
} satisfies AustralianPiiFields;

const LONG_NAME_FIELDS = {
  employeeName: "Maximiliana Alexandria Catherine Papadopoulos-Okafor-Rēweti",
  position: "Principal Engineering Manager, Payroll Platform and Integrations",
  department: "Finance",
  employerAbn: "12-345-678-901",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Maximiliana Alexandria Catherine Papadopoulos-Okafor-Rēweti",
  address: {
    lines: ["12 Example St"],
    suburb: "Sydney",
    stateOrTerritory: "NSW",
    postcode: "2000",
  },
} satisfies AustralianPiiFields;

/**
 * A spread of names, roles, departments, and account names (accented,
 * hyphenated, right-to-left, and CJK characters) to prove styling holds
 * machine readability across the variety of PII issuers actually emit, all at
 * the minimum raster width.
 */
const DIVERSE_RECORDS: ReadonlyArray<{ label: string; fields: AustralianPiiFields }> = [
  {
    label: "Irish particles",
    fields: {
      employeeName: "Aoife Ní Bhraonáin",
      position: "QA Engineer",
      department: "Engineering",
      employerAbn: "51-824-753-556",
      bsb: "083-004",
      accountNumber: "55512345",
      accountName: "Aoife Ní Bhraonáin",
    },
  },
  {
    label: "Several given and family names",
    fields: {
      employeeName: "José María García-López",
      position: "Office Coordinator",
      department: "Operations",
      employerAbn: "33-051-775-556",
      bsb: "062-001",
      accountNumber: "10293847",
      accountName: "José María García-López",
    },
  },
  {
    label: "Vietnamese diacritics, family name first",
    fields: {
      employeeName: "Trần Thị Mai Anh",
      position: "Operations Manager",
      department: "Operations",
      employerAbn: "29-002-589-460",
      bsb: "923-100",
      accountNumber: "44556677",
      accountName: "Trần Thị Mai Anh",
    },
  },
  {
    label: "Chinese script, family name first",
    fields: {
      employeeName: "张伟 (Zhang Wei)",
      position: "Sales Representative",
      department: "Sales",
      employerAbn: "11-004-447-790",
      bsb: "013-006",
      accountNumber: "98761234",
      accountName: "张伟 (Zhang Wei)",
    },
  },
  {
    label: "Tone marks, dots below",
    fields: {
      employeeName: "Olúwaṣẹ́gun Adébáyọ̀",
      position: "Senior Accountant",
      department: "Finance",
      employerAbn: "72-629-770-111",
      bsb: "484-799",
      accountNumber: "11224455",
      accountName: "Olúwaṣẹ́gun Adébáyọ̀",
    },
  },
  {
    label: "Latin diacritics",
    fields: {
      employeeName: "José Müller",
      position: "Customer Support Officer",
      department: "Operations",
      employerAbn: "60-008-661-002",
      bsb: "036-002",
      accountNumber: "33445566",
      accountName: "José Müller",
    },
  },
  {
    label: "Right-to-left script",
    fields: {
      employeeName: "فاطمة السيد (Fatima Al-Sayed)",
      position: "Engineering Manager",
      department: "Engineering",
      employerAbn: "45-110-892-340",
      bsb: "112-879",
      accountNumber: "77889900",
      accountName: "فاطمة السيد (Fatima Al-Sayed)",
    },
  },
  {
    label: "Macrons",
    fields: {
      employeeName: "Rāwiri Hōhaia",
      position: "Product Designer",
      department: "Product",
      employerAbn: "98-771-203-884",
      bsb: "021-000",
      accountNumber: "12309876",
      accountName: "Rāwiri Hōhaia",
    },
  },
] as const;

function encryptFixture(plaintext: string): Buffer {
  // Derive a unique IV per plaintext so distinct fixtures never reuse an
  // IV under the same key (the real AES-GCM footgun), while staying
  // deterministic for reproducible tests. Production uses a random IV.
  const iv = createHash("sha256").update(plaintext).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", FIXTURE_KEY, iv);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
}

function partsFromPii(fields: AustralianPiiFields): { parts: BarcodeParts; plaintext: string } {
  const plaintext = formatAustralianPii(fields);
  return {
    parts: {
      verifiablReference: VERIFIABL_REF,
      encryptedPii: encryptFixture(plaintext),
    },
    plaintext,
  };
}

async function decodePixels(svg: string, rasterWidth: number): Promise<string> {
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: rasterWidth } }).render();
  const result = await decodeQrImage(rendered.asPng());
  if (!result) throw new Error(`QR code could not be decoded at ${rasterWidth}px`);
  return result;
}

/**
 * Place the badge on a host page the way the docs require: a light ground with
 * the quiet-zone margin around it. The QR spans the badge's full width, so the
 * host, not the badge, supplies the quiet zone on the left, right and bottom.
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
function decode(
  parts: BarcodeParts,
  options: BarcodeSvgOptions = {},
  rasterWidth = 900,
): Promise<string> {
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
  it("decodes the framed badge back to the scan URL", async () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    expect(await decode(parts)).toBe(createBarcodeSvg(parts).content);
  });

  it("paints the ground white under the QR and keeps the header corners transparent", () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const transparent = { r: 0, g: 0, b: 0, a: 0 };
    const white = { r: 255, g: 255, b: 255, a: 255 };
    // The header's rounded top corners stay transparent.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 0)).toEqual(transparent);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 0)).toEqual(transparent);
    // The gap between header and QR (47u to 54u; sampled at 50.5u) is white
    // across the full width.
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 0, 221)).toEqual(white);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 210, 221)).toEqual(white);
    expect(sampleRenderedPixel(svg, GEOMETRY_RASTER_WIDTH, 419, 221)).toEqual(white);
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

  it("keeps the symbol's ground white over a dark host", () => {
    // The white ground is part of the badge, so the QR's light modules and its
    // top quiet zone never depend on the host. Only the side and bottom margin
    // does, which is the documented placement rule.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { svg } = createBarcodeSvg(parts);
    const hosted = placeOnHostPage(svg, "#010A4F");
    const rasterWidth = hostRasterWidth(GEOMETRY_RASTER_WIDTH);
    const scale = rasterWidth / (BADGE_VIEWBOX_WIDTH + 2 * HOST_MARGIN_UNITS);
    const gapY = Math.round(50.5 * scale);
    const badgeLeft = Math.round(HOST_MARGIN_UNITS * scale);
    const white = { r: 255, g: 255, b: 255, a: 255 };
    expect(sampleRenderedPixel(hosted, rasterWidth, badgeLeft + 1, gapY)).toEqual(white);
    expect(sampleRenderedPixel(hosted, rasterWidth, Math.round(rasterWidth / 2), gapY)).toEqual(
      white,
    );
    // The margin itself is the host's colour.
    expect(sampleRenderedPixel(hosted, rasterWidth, 2, gapY)).toEqual({
      r: 1,
      g: 10,
      b: 79,
      a: 255,
    });
  });

  it("decoded URL round-trips to the original payload", async () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const scanned = new URL(await decode(parts));
    const reference = scanned.pathname.slice(scanned.pathname.lastIndexOf("/") + 1);
    const ciphertext = scanned.hash.slice("#2.".length);

    expect(`2|${reference}|${ciphertext}`).toBe(buildBarcodePayload(parts));
  });

  it("decodes the mixed-mode v2 symbol byte-exactly", async () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const expected = createBarcodeSvg(parts);
    const scanned = await decode(parts, {}, MIN_TESTED_RASTER_WIDTH);

    expect(scanned).toBe(expected.content);
    expect(scanned).toMatch(/^https:\/\/v\.verifiabl\.io\/v\/[A-Za-z0-9_-]{22}#2\.[A-Z2-7]+$/);
    expect(expected.errorCorrectionLevel).toBe("M");
    expect(expected.qrVersion).toBeGreaterThan(0);
  });

  it("decodes the encrypted docs PII example at the minimum raster width", async () => {
    const { parts, plaintext } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    expect(plaintext).toBe(
      "AU2|Ana Leota|Senior Developer|Engineering|12-345-678-901|062-000|12345678|A Leota|12 Example St, Sydney NSW 2000",
    );
    expect(parts.encryptedPii.length).toBe(Buffer.byteLength(plaintext));
    expect(await decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  it("decodes longer employee fields at the minimum raster width", async () => {
    const { parts, plaintext } = partsFromPii(LONG_NAME_FIELDS);
    expect(plaintext.length).toBeGreaterThan(formatAustralianPii(DOCS_EXAMPLE_FIELDS).length);
    expect(parts.encryptedPii.length).toBe(Buffer.byteLength(plaintext));
    expect(await decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(createBarcodeSvg(parts).content);
  });

  it.each(DIVERSE_RECORDS)(
    "decodes a diverse record at the minimum raster width ($label)",
    async ({ fields }) => {
      const { parts } = partsFromPii(fields);
      expect(await decode(parts, {}, MIN_TESTED_RASTER_WIDTH)).toBe(
        createBarcodeSvg(parts).content,
      );
    },
  );

  it("defaults to error-correction M and renders a clean (non-degraded) code", () => {
    // The default ceiling is M, not Q: a realistic record is one or two QR
    // versions smaller (larger modules) than under Q, and not flagged degraded.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const result = createBarcodeSvg(parts);
    expect(result.errorCorrectionLevel).toBe("M");
    expect(result.degraded).toBe(false);
  });

  it("maxErrorCorrection 'Q' stays available and yields a denser code", async () => {
    // Opting back into Q packs the same payload into more (smaller) modules for
    // extra damage recovery; both encodings remain scannable and non-degraded.
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const defaultResult = createBarcodeSvg(parts);
    const qResult = createBarcodeSvg(parts, { maxErrorCorrection: "Q" });
    expect(qResult.errorCorrectionLevel).toBe("Q");
    expect(qResult.degraded).toBe(false);
    // Denser: Q's modules are smaller than the default M's at the same width.
    expect(qResult.modulePx).toBeLessThan(defaultResult.modulePx);
    expect(await decode(parts, { maxErrorCorrection: "Q" })).toBe(qResult.content);
  });

  it("decodes the framed badge across larger raster scales", async () => {
    const { parts } = partsFromPii(DOCS_EXAMPLE_FIELDS);
    const { content } = createBarcodeSvg(parts);
    for (const rasterWidth of [500, 900, 1600]) {
      expect(await decode(parts, {}, rasterWidth)).toBe(content);
    }
  });
});
