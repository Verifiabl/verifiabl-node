import QRCode from "qrcode";
import { buildScanUrl } from "../payload.js";
import { createBarcodeSvg } from "../qr/styled.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv";
const CIPHERTEXT = "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w";
const PARTS = { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT };
const FRAME_GEOMETRY = [
  'viewBox="0 0 96 151"',
  'width="94" height="149" rx="7" stroke="#ADADAD" stroke-width="2" fill="none"',
  "M0 8C0 3.58172 3.58172 0 8 0H88",
  'transform="translate(8 23) scale(1)"',
];

function expectedQrTransform(content: string): string {
  // Mirror the default render, which uses the "M" error-correction ceiling.
  const qr = QRCode.create(content, { errorCorrectionLevel: "M" });
  const moduleSize = 80 / (qr.modules.size + 2);
  return `transform="translate(${round2(8 + moduleSize)} ${round2(59 + moduleSize)})"`;
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

  it("renders square data modules and rounded finder sections", () => {
    const { svg, content } = createBarcodeSvg(PARTS);
    const qr = QRCode.create(content, { errorCorrectionLevel: "M" });
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
    const frameBorderCount = 1;
    const frameBackgroundCount = 1;
    expect(rectCount).toBe(
      darkDataModules + finderDotCount + frameBorderCount + frameBackgroundCount,
    );
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("renders the supplied branded frame geometry by default", () => {
    const { svg, width, height, content } = createBarcodeSvg(PARTS);
    for (const expected of FRAME_GEOMETRY) {
      expect(svg).toContain(expected);
    }
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // White, rounded-rect frame body so the QR quiet zone is always light.
    expect(svg).toContain('width="94" height="149" rx="7" fill="#FFFFFF"');
    expect(svg).not.toContain('stroke="#000000"');
    expect(svg).not.toContain('width="94" height="149" rx="7" fill="#000000"');
    expect(svg).not.toContain('x="16" y="59" width="80" height="80" fill="#FFFFFF"');
    expect(svg).toContain(expectedQrTransform(content));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBe(480);
    expect(height).toBe(755);
  });

  it("keeps frame and QR placement fixed as payload size changes", () => {
    const short = createBarcodeSvg(PARTS);
    const long = createBarcodeSvg({ ...PARTS, encryptedPii: "A".repeat(300) });

    for (const expected of FRAME_GEOMETRY) {
      expect(short.svg).toContain(expected);
      expect(long.svg).toContain(expected);
    }
    expect(short.svg).toContain(expectedQrTransform(short.content));
    expect(long.svg).toContain(expectedQrTransform(long.content));
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

  // Quiet zone: the white margin from the inner frame border to the QR matrix
  // must be >= 4 modules. The fixed white gutter covers it for dense symbols;
  // small/sparse symbols (large modules) get a larger internal inset. "AA" is
  // a tiny payload that exercises the inset path.
  it.each([
    "AA",
    CIPHERTEXT,
    "a".repeat(600),
  ])("keeps the QR quiet zone at >= 4 modules (payload length %#)", (encryptedPii) => {
    const { svg } = createBarcodeSvg({ ...PARTS, encryptedPii });
    const moduleSize = Number(/width="([\d.]+)" height="\1" fill="#000000"/.exec(svg)?.[1]);
    const qrTranslateX = Number(
      /translate\(([\d.]+) [\d.]+\)"><g shape-rendering="crispEdges"/.exec(svg)?.[1],
    );
    // Inner edge of the 2px border (path at x=1) sits at x=2; body is white from there.
    const quietZoneModules = (qrTranslateX - 2) / moduleSize;
    expect(quietZoneModules).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  // From the default "M" ceiling, the ladder keeps M (flagging degraded once
  // modules fall below the ideal size) until even M won't fit, then drops to L,
  // never varying the fixed frame. Lowercase base64url ("a") forces byte mode
  // like real encrypted PII. Thresholds are at width 480.
  it.each([
    { label: "stays M, sub-ideal modules", ciphertext: "a".repeat(1000), ec: "M" },
    { label: "stays M near the floor", ciphertext: "a".repeat(1100), ec: "M" },
    { label: "longest fittable: drops to L", ciphertext: "a".repeat(1300), ec: "L" },
  ])("degrades error correction in order for $label", ({ ciphertext, ec }) => {
    const result = createBarcodeSvg({ ...PARTS, encryptedPii: ciphertext });
    expect(result.errorCorrectionLevel).toBe(ec);
    expect(result.degraded).toBe(true);
    expect(result.modulePx).toBeGreaterThanOrEqual(3);
    // Frame dimensions are unchanged regardless of degradation.
    expect(result.width).toBe(480);
    expect(result.height).toBe(755);
  });

  it("hard-errors when PII cannot fit the fixed frame even at the lowest level", () => {
    // Too dense to clear the floor even at L, but still within QR capacity.
    expect(() => createBarcodeSvg({ ...PARTS, encryptedPii: "a".repeat(1600) })).toThrow(
      /too long to render a scannable barcode in the branded frame/,
    );
  });

  it("throws a clear error when PII exceeds QR code capacity entirely", () => {
    // Beyond what any QR version can hold at any level: the qrcode library
    // would otherwise throw a cryptic 'data too big' error deep in the renderer.
    expect(() => createBarcodeSvg({ ...PARTS, encryptedPii: "a".repeat(3000) })).toThrow(
      /too large to encode in a QR code/,
    );
  });
});

function isFinderModule(row: number, col: number, size: number): boolean {
  const finderSize = 7;
  const inTop = row < finderSize;
  const inLeft = col < finderSize;
  const inRight = col >= size - finderSize;
  const inBottom = row >= size - finderSize;
  return (inTop && inLeft) || (inTop && inRight) || (inBottom && inLeft);
}
