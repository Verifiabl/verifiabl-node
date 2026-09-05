import QRCode from "qrcode";
import { buildBarcodePayload, buildScanUrl } from "../payload.js";
import { buildQrEncoding, createBarcodeSvg, QrCapacityError } from "../qr/styled.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv";
const CIPHERTEXT = "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w";
const PARTS = { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT };
const FRAME_GEOMETRY = [
  'viewBox="0 0 96 150"',
  "M0 8C0 3.58172 3.58172 0 8 0H88",
  'transform="translate(8 23) scale(1)"',
];
// Header height plus the transparent gap above the full-width QR box.
const QR_BOX_TOP = 54;
const QR_BOX_SIZE = 96;
const QR_GAP = 7;

/** Mirror the renderer's inset rule: the gap plus the inset must span 4 modules. */
function expectedInsetModules(size: number): number {
  for (let inset = 0; inset < 4; inset++) {
    const moduleSize = QR_BOX_SIZE / (size + inset * 2);
    if (QR_GAP / moduleSize + inset >= 4) return inset;
  }
  return 4;
}

function expectedQrTransform(parts = PARTS): string {
  // Mirror the default render, which uses the "M" error-correction ceiling.
  const encoding = buildQrEncoding(parts, {});
  const qr = QRCode.create(encoding.data, { errorCorrectionLevel: "M" });
  const inset = expectedInsetModules(qr.modules.size);
  const moduleSize = QR_BOX_SIZE / (qr.modules.size + inset * 2);
  const padding = inset * moduleSize;
  return `transform="translate(${round2(padding)} ${round2(QR_BOX_TOP + padding)})"`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe("createBarcodeSvg", () => {
  it("encodes the /v/ scan URL by default", () => {
    const { content } = createBarcodeSvg(PARTS);
    expect(content).toBe(buildScanUrl(PARTS));
  });

  it("uses the sandbox scan URL when environment is sandbox", () => {
    const { content } = createBarcodeSvg(PARTS, { environment: "sandbox" });
    expect(content).toBe(buildScanUrl(PARTS, { environment: "sandbox" }));
  });

  it("encodes v2 as an explicit byte prefix and alphanumeric ciphertext segment", () => {
    const encoding = buildQrEncoding(PARTS, {});
    expect(Array.isArray(encoding.data)).toBe(true);
    if (!Array.isArray(encoding.data)) throw new Error("expected segmented v2 QR data");
    expect(encoding.data).toHaveLength(2);
    const prefix = encoding.data[0];
    const ciphertext = encoding.data[1];
    if (prefix?.mode !== "byte" || ciphertext?.mode !== "alphanumeric") {
      throw new Error("expected byte/alphanumeric segments");
    }
    expect(Buffer.from(prefix.data).toString("utf8")).toBe(
      `https://v.verifiabl.io/v/${VERIFIABL_REF}#2.`,
    );
    expect(ciphertext.data).toMatch(/^[A-Z2-7]+$/);
    expect(createBarcodeSvg(PARTS).content).toBe(encoding.content);
    expect(buildBarcodePayload(PARTS).split("|")[2]).toBe(encoding.content.split("#2.")[1]);
  });

  it("renders square data modules and rounded finder sections", () => {
    const { svg } = createBarcodeSvg(PARTS);
    const qr = QRCode.create(buildQrEncoding(PARTS, {}).data, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;

    let darkDataModules = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (isFinderModule(row, col, size)) continue;
        if (qr.modules.data[row * size + col]) darkDataModules++;
      }
    }

    const rectCount = (svg.match(/<rect /g) ?? []).length;
    const finderDotCount = 3;
    expect(rectCount).toBe(darkDataModules + finderDotCount);
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("renders the supplied branded frame geometry by default", () => {
    const { svg, width, height } = createBarcodeSvg(PARTS);
    for (const expected of FRAME_GEOMETRY) {
      expect(svg).toContain(expected);
    }
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // No border and no card: the navy header is the first element, and nothing
    // paints the ground, so the badge is transparent outside header and modules.
    expect(svg).toMatch(/^<svg [^>]*><path d="M0 8C0 3\.58172/);
    expect(svg).not.toContain("stroke=");
    expect(svg).not.toContain('<rect x="1" y="1"');
    expect(svg).toContain(expectedQrTransform());
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBe(480);
    expect(height).toBe(750);
  });

  it("keeps frame and QR placement fixed as payload size changes", () => {
    const short = createBarcodeSvg(PARTS);
    const long = createBarcodeSvg({ ...PARTS, encryptedPii: "A".repeat(300) });

    for (const expected of FRAME_GEOMETRY) {
      expect(short.svg).toContain(expected);
      expect(long.svg).toContain(expected);
    }
    expect(short.svg).toContain(expectedQrTransform(PARTS));
    expect(long.svg).toContain(expectedQrTransform({ ...PARTS, encryptedPii: "A".repeat(300) }));
    expect(short.height).toBe(long.height);
    expect(short.content).not.toBe(long.content);
  });

  it("respects custom width", () => {
    const { svg, width } = createBarcodeSvg(PARTS, { width: 720 });
    expect(width).toBe(720);
    expect(svg).toContain('width="720"');
  });

  it("rejects invalid widths", () => {
    expect(() => createBarcodeSvg(PARTS, { width: 0 })).toThrow("width");
    expect(() => createBarcodeSvg(PARTS, { width: 479 })).toThrow("at least 480");
  });

  it("renders the common case pristine: M error correction, not degraded", () => {
    const result = createBarcodeSvg(PARTS);
    expect(result.errorCorrectionLevel).toBe("M");
    expect(result.degraded).toBe(false);
    expect(result.modulePx).toBeGreaterThanOrEqual(4);
  });

  it("raises density on demand: maxErrorCorrection 'Q' uses Q, still not degraded", () => {
    const result = createBarcodeSvg(PARTS, { maxErrorCorrection: "Q" });
    expect(result.errorCorrectionLevel).toBe("Q");
    expect(result.degraded).toBe(false);
    // Q packs more modules in the fixed box, so each module is smaller.
    expect(result.modulePx).toBeLessThan(createBarcodeSvg(PARTS).modulePx);
  });

  it("rejects an invalid maxErrorCorrection instead of silently forcing L", () => {
    // An untyped (JS) caller could pass a value outside "Q" | "M"; the ladder
    // must fail loudly rather than slice down to the weakest level.
    expect(() =>
      createBarcodeSvg(PARTS, {
        maxErrorCorrection: "L" as unknown as "Q" | "M",
      }),
    ).toThrow(/maxErrorCorrection must be "Q" or "M"/);
  });

  // Quiet zone: the light margin between the navy header and the QR matrix
  // must be >= 4 modules (the host document supplies the other three sides).
  // The fixed gap covers it for dense symbols; small/sparse symbols (large
  // modules) get an internal inset. "AA" is a tiny payload that exercises the
  // inset path.
  it.each([
    "AA",
    CIPHERTEXT,
    "a".repeat(600),
  ])("keeps the QR quiet zone below the header at >= 4 modules (payload length %#)", (encryptedPii) => {
    const { svg } = createBarcodeSvg({ ...PARTS, encryptedPii });
    const moduleSize = Number(/width="([\d.]+)" height="\1" fill="#000000"/.exec(svg)?.[1]);
    const qrTranslateY = Number(
      /translate\([\d.]+ ([\d.]+)\)"><g shape-rendering="crispEdges"/.exec(svg)?.[1],
    );
    const headerBottom = 47;
    const quietZoneModules = (qrTranslateY - headerBottom) / moduleSize;
    expect(quietZoneModules).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  it("spans the full badge width for a dense symbol (no side inset)", () => {
    const { svg } = createBarcodeSvg({ ...PARTS, encryptedPii: "a".repeat(600) });
    expect(svg).toContain(`translate(0 ${QR_BOX_TOP})"><g shape-rendering="crispEdges"`);
  });

  // From the default "M" ceiling, the ladder keeps M (flagging degraded once
  // modules fall below the ideal size) until even M won't fit, then drops to L,
  // never varying the fixed frame. Lowercase base64url ("a") forces byte mode
  // like real encrypted PII. Thresholds are at width 480.
  it.each([
    { label: "stays M, sub-ideal modules", ciphertext: "a".repeat(1000), ec: "M" },
    { label: "stays M near the floor", ciphertext: "a".repeat(1700), ec: "M" },
    { label: "longest fittable: drops to L", ciphertext: "a".repeat(1800), ec: "L" },
  ])("degrades error correction in order for $label", ({ ciphertext, ec }) => {
    const result = createBarcodeSvg({ ...PARTS, encryptedPii: ciphertext }, { format: "v1" });
    expect(result.errorCorrectionLevel).toBe(ec);
    expect(result.degraded).toBe(true);
    expect(result.modulePx).toBeGreaterThanOrEqual(3);
    // Frame dimensions are unchanged regardless of degradation.
    expect(result.width).toBe(480);
    expect(result.height).toBe(750);
  });

  it("hard-errors when PII cannot fit the fixed frame even at the lowest level", () => {
    // Too dense to clear the floor even at L, but still within QR capacity.
    const parts = { ...PARTS, encryptedPii: "a".repeat(2500) };
    expect(() => createBarcodeSvg(parts, { format: "v1" })).toThrow(
      /too long to render a scannable barcode in the branded frame/,
    );

    const error = capacityErrorFrom(() => createBarcodeSvg(parts, { format: "v1" }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QrCapacityError");
    expect(error.reason).toBe("frame-fit");
    expect(error.contentLength).toBe(buildScanUrl(parts, { format: "v1" }).length);
    expect(error.badgeWidth).toBe(480);
  });

  it("throws a clear error when PII exceeds QR code capacity entirely", () => {
    // Beyond what any QR version can hold at any level: the qrcode library
    // would otherwise throw a cryptic 'data too big' error deep in the renderer.
    const parts = { ...PARTS, encryptedPii: "a".repeat(6000) };
    expect(() => createBarcodeSvg(parts)).toThrow(/too large to encode in a QR code/);

    const error = capacityErrorFrom(() => createBarcodeSvg(parts, { width: 720 }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QrCapacityError");
    expect(error.reason).toBe("qr-capacity");
    expect(error.contentLength).toBe(buildScanUrl(parts).length);
    expect(error.badgeWidth).toBe(720);
  });
});

/** Run the renderer and hand back the QrCapacityError it is expected to throw. */
function capacityErrorFrom(render: () => unknown): QrCapacityError {
  try {
    render();
  } catch (error) {
    if (error instanceof QrCapacityError) return error;
    throw error;
  }
  throw new Error("Expected the renderer to throw QrCapacityError");
}

function isFinderModule(row: number, col: number, size: number): boolean {
  const finderSize = 7;
  const inTop = row < finderSize;
  const inLeft = col < finderSize;
  const inRight = col >= size - finderSize;
  const inBottom = row >= size - finderSize;
  return (inTop && inLeft) || (inTop && inRight) || (inBottom && inLeft);
}
