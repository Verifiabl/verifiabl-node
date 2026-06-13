import QRCode from "qrcode";
import { buildScanUrl } from "../payload.js";
import { createBarcodeSvg } from "../qr/styled.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv";
const CT = "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w";
const PARTS = { linkingToken: LT, encryptedPii: CT };
const FRAME_GEOMETRY = [
  'viewBox="0 0 96 151"',
  'width="94" height="149" rx="7" stroke="#ADADAD" stroke-width="2" fill="none"',
  "M0 8C0 3.58172 3.58172 0 8 0H88",
  'transform="translate(8 23) scale(1)"',
];

function expectedQrTransform(content: string): string {
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
    expect(rectCount).toBe(darkDataModules + finderDotCount + frameBorderCount);
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("renders the supplied branded frame geometry by default", () => {
    const { svg, width, height, content } = createBarcodeSvg(PARTS);
    for (const expected of FRAME_GEOMETRY) {
      expect(svg).toContain(expected);
    }
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toContain('stroke="#000000"');
    expect(svg).not.toContain('width="94" height="149" rx="7" fill="#000000"');
    expect(svg).not.toContain('x="16" y="59" width="80" height="80" fill="#FFFFFF"');
    expect(svg).toContain(expectedQrTransform(content));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBe(420);
    expect(height).toBe(660.63);
  });

  it("keeps frame and QR placement fixed as payload size changes", () => {
    const short = createBarcodeSvg(PARTS);
    const long = createBarcodeSvg({ ...PARTS, encryptedPii: "A".repeat(600) });

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
    expect(() => createBarcodeSvg(PARTS, { width: 419 })).toThrow("at least 420");
  });

  it("uses the product-selected QR error correction level", () => {
    const { content } = createBarcodeSvg(PARTS);
    const qr = QRCode.create(content, { errorCorrectionLevel: "M" });
    expect(qr.modules.size).toBeGreaterThan(0);
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
