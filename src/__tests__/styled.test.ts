import QRCode from "qrcode";
import { buildScanUrl } from "../payload.js";
import { createBarcodeSvg } from "../qr/styled.js";

const LT = "AbCdEfGhIjKlMnOpQrStUv";
const CT = "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w";
const PARTS = { linkingToken: LT, encryptedPii: CT };

describe("createBarcodeSvg", () => {
  it("encodes the /v/ scan URL by default", () => {
    const { content } = createBarcodeSvg(PARTS);
    expect(content).toBe(buildScanUrl(PARTS));
  });

  it("can encode the bare payload", () => {
    const { content } = createBarcodeSvg(PARTS, { encode: "payload" });
    expect(content).toBe(`1|${LT}|${CT}`);
  });

  it("renders one dot per dark non-finder module", () => {
    const { svg, content } = createBarcodeSvg(PARTS);
    const qr = QRCode.create(content, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;

    let darkOutsideFinders = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const inFinder =
          (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
        if (!inFinder && qr.modules.data[row * size + col]) darkOutsideFinders++;
      }
    }

    // Per finder: 1 ring rect + 1 inner rect. Plus card + panel rects and one rect per dot.
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBe(darkOutsideFinders + 6 + 2);
  });

  it("renders the branded frame with header by default", () => {
    const { svg, width, height } = createBarcodeSvg(PARTS);
    expect(svg).toContain("Secured by");
    expect(svg).toContain("Verifiabl");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBe(360);
    expect(height).toBeGreaterThan(width); // header band adds height
  });

  it("omits frame and header when frame=false", () => {
    const { svg, width, height } = createBarcodeSvg(PARTS, { frame: false });
    expect(svg).not.toContain("Secured by");
    expect(width).toBe(height);
  });

  it("escapes XML in custom header text", () => {
    const { svg } = createBarcodeSvg(PARTS, { headerText: 'Powered by <"&>' });
    expect(svg).toContain("Powered by &lt;&quot;&amp;&gt;");
    expect(svg).not.toContain('by <"&>');
  });

  it("applies custom colours", () => {
    const { svg } = createBarcodeSvg(PARTS, { colors: { navy: "#123456" } });
    expect(svg).toContain("#123456");
  });

  it("rejects unsafe colour attributes", () => {
    expect(() => createBarcodeSvg(PARTS, { colors: { navy: '" onload="alert(1)' } })).toThrow(
      "colors.navy",
    );
    expect(() =>
      createBarcodeSvg(PARTS, { colors: { panel: "url(javascript:alert(1))" } }),
    ).toThrow("colors.panel");
  });

  it("respects custom width", () => {
    const { svg, width } = createBarcodeSvg(PARTS, { width: 720 });
    expect(width).toBe(720);
    expect(svg).toContain('width="720"');
  });

  it("rejects invalid widths", () => {
    expect(() => createBarcodeSvg(PARTS, { width: 0 })).toThrow("width");
  });

  it("uses higher ECC levels on request", () => {
    const m = createBarcodeSvg(PARTS, { errorCorrectionLevel: "M" });
    const h = createBarcodeSvg(PARTS, { errorCorrectionLevel: "H" });
    const mSize = QRCode.create(m.content, { errorCorrectionLevel: "M" }).modules.size;
    const hSize = QRCode.create(h.content, { errorCorrectionLevel: "H" }).modules.size;
    expect(hSize).toBeGreaterThanOrEqual(mSize);
  });
});
