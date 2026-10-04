import QRCode from "qrcode";
import { buildBarcodePayload, buildScanUrl } from "../payload.js";
import { buildQrEncoding, createBarcodeSvg, QrCapacityError } from "../qr/styled.js";

const VERIFIABL_REF = "AbCdEfGhIjKlMnOpQrStUv";
const CIPHERTEXT = Buffer.from("Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w", "base64url");
const PARTS = { verifiablReference: VERIFIABL_REF, encryptedPii: CIPHERTEXT };
const FRAME_GEOMETRY = [
  'viewBox="0 0 96 150"',
  "M0 8C0 3.58172 3.58172 0 8 0H88",
  'transform="translate(8 23) scale(1)"',
];
// Header height plus the white gap above the full-width QR box.
const QR_BOX_TOP = 54;
const QR_GAP = 7;
// Every symbol sits at the box origin: the QR fills the box edge to edge.
const QR_TRANSFORM = `transform="translate(0 ${QR_BOX_TOP})"`;

describe("createBarcodeSvg", () => {
  it("rejects a removed format option before rendering", () => {
    expect(() => createBarcodeSvg(PARTS, { format: "v1" } as never)).toThrow("only issues v2");
  });

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
    const groundCount = 1;
    expect(rectCount).toBe(darkDataModules + finderDotCount + groundCount);
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("renders the supplied branded frame geometry by default", () => {
    const { svg, width, height } = createBarcodeSvg(PARTS);
    for (const expected of FRAME_GEOMETRY) {
      expect(svg).toContain(expected);
    }
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // No border: a full-width white ground under the header and the QR box,
    // then the navy header on top of it.
    expect(svg).toMatch(
      /^<svg [^>]*><rect x="0" y="39" width="96" height="111" fill="#FFFFFF"\/><path d="M0 8C0 3\.58172/,
    );
    expect(svg).not.toContain("stroke=");
    expect(svg).not.toContain('<rect x="1" y="1"');
    expect(svg).toContain(QR_TRANSFORM);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBe(480);
    expect(height).toBe(750);
  });

  it("keeps frame and QR placement fixed as payload size changes", () => {
    const short = createBarcodeSvg(PARTS);
    const long = createBarcodeSvg({
      ...PARTS,
      encryptedPii: Buffer.from("A".repeat(300), "base64url"),
    });

    for (const expected of FRAME_GEOMETRY) {
      expect(short.svg).toContain(expected);
      expect(long.svg).toContain(expected);
    }
    expect(short.svg).toContain(QR_TRANSFORM);
    expect(long.svg).toContain(QR_TRANSFORM);
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

  // The badge's own quiet zone is the fixed 7-unit gap below the header (the
  // host document supplies the other three sides). Every symbol, tiny or dense,
  // fills the QR box edge to edge; the gap is 4 modules or more for any full
  // record (version 10 and up) and proportionally less for shorter payloads.
  it.each([Buffer.from("AA", "base64url"), CIPHERTEXT, Buffer.from("a".repeat(600), "base64url")])(
    "places every symbol at the box origin, edge to edge (payload length %#)",
    (encryptedPii) => {
      const { svg } = createBarcodeSvg({ ...PARTS, encryptedPii });
      expect(svg).toContain(`${QR_TRANSFORM}><g shape-rendering="crispEdges"`);
    },
  );

  it("keeps the gap below the header at >= 4 modules for a full record", () => {
    const { svg, qrVersion } = createBarcodeSvg({
      ...PARTS,
      encryptedPii: Buffer.from("a".repeat(600), "base64url"),
    });
    expect(qrVersion).toBeGreaterThanOrEqual(10);
    const moduleSize = Number(/width="([\d.]+)" height="\1" fill="#000000"/.exec(svg)?.[1]);
    expect(QR_GAP / moduleSize).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  // From the default "M" ceiling, the ladder keeps M (flagging degraded once
  // modules fall below the ideal size) until even M won't fit, then drops to L,
  // never varying the fixed frame. Thresholds are at width 480.
  it.each([
    {
      label: "stays M, sub-ideal modules",
      ciphertext: Buffer.from("a".repeat(1200), "base64url"),
      ec: "M",
    },
    {
      label: "stays M near the floor",
      ciphertext: Buffer.from("a".repeat(1900), "base64url"),
      ec: "M",
    },
    {
      label: "longest fittable: drops to L",
      ciphertext: Buffer.from("a".repeat(2500), "base64url"),
      ec: "L",
    },
  ])("degrades error correction in order for $label", ({ ciphertext, ec }) => {
    const result = createBarcodeSvg({ ...PARTS, encryptedPii: ciphertext });
    expect(result.errorCorrectionLevel).toBe(ec);
    expect(result.degraded).toBe(true);
    expect(result.modulePx).toBeGreaterThanOrEqual(3);
    // Frame dimensions are unchanged regardless of degradation.
    expect(result.width).toBe(480);
    expect(result.height).toBe(750);
  });

  it("hard-errors when PII cannot fit the fixed frame even at the lowest level", () => {
    // Too dense to clear the floor even at L, but still within QR capacity.
    const parts = {
      ...PARTS,
      encryptedPii: Buffer.from("a".repeat(2900), "base64url"),
    };
    expect(() => createBarcodeSvg(parts)).toThrow(
      /too long to render a scannable barcode in the branded frame/,
    );

    const error = capacityErrorFrom(() => createBarcodeSvg(parts));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QrCapacityError");
    expect(error.reason).toBe("frame-fit");
    expect(error.contentLength).toBe(buildScanUrl(parts).length);
    expect(error.badgeWidth).toBe(480);
  });

  it("throws a clear error when PII exceeds QR code capacity entirely", () => {
    // Beyond what any QR version can hold at any level: the qrcode library
    // would otherwise throw a cryptic 'data too big' error deep in the renderer.
    const parts = { ...PARTS, encryptedPii: Buffer.from("a".repeat(6000), "base64url") };
    expect(() => createBarcodeSvg(parts)).toThrow(/too large to encode in a QR code/);

    const error = capacityErrorFrom(() => createBarcodeSvg(parts, { width: 720 }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QrCapacityError");
    expect(error.reason).toBe("qr-capacity");
    expect(error.contentLength).toBe(buildScanUrl(parts).length);
    expect(error.badgeWidth).toBe(720);
  });
});

describe("createBarcodeSvg horizontal layout", () => {
  const FULL_RECORD = { ...PARTS, encryptedPii: Buffer.from("a".repeat(600), "base64url") };

  it("renders the explicit vertical layout exactly as the default", () => {
    expect(createBarcodeSvg(PARTS, { layout: "vertical" }).svg).toBe(createBarcodeSvg(PARTS).svg);
  });

  it("puts the QR box at full height on the left, then a white gap and the tinted frame", () => {
    const { svg, width, height } = createBarcodeSvg(PARTS, { layout: "horizontal" });
    expect(width).toBe(940);
    expect(height).toBe(480);
    expect(svg).toContain('viewBox="0 0 188 96"');
    // White under the 96-unit QR box and the vertical layout's 7-unit gap, then
    // the 85-unit panel with the 70x80 design scaled to the QR box's height.
    expect(svg).toMatch(
      /^<svg [^>]*><rect x="0" y="0" width="103" height="96" fill="#FFFFFF"\/><g transform="translate\(103 0\)"><path d="M0 0H75\.4C[^"]*85 9\.6V86\.4C[^"]*" fill="#EDEFFF"\/><g transform="translate\(0\.5 0\) scale\(1\.2\)" fill="#010A4F">/,
    );
    // Opaque, so the QR's right quiet zone stays light on any page.
    expect(svg).toContain('fill="#EDEFFF"/>');
    expect(svg).not.toContain("opacity");
    expect(svg).toContain('<g transform="translate(0 0)"><g shape-rendering="crispEdges">');
    expect(svg).toContain('aria-label="Secured by Verifiabl verification barcode"');
    expect(svg).not.toContain("M0 8C0 3.58172");
    expect(svg).not.toContain("clipPath");
    expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]/);
    expect((svg.match(/fill-rule="evenodd"/g) ?? []).length).toBe(3);
  });

  it.each([
    [480, 940],
    [720, 1410],
  ])("renders the same QR as the vertical badge at %d when %d wide", (verticalWidth, width) => {
    const vertical = createBarcodeSvg(FULL_RECORD, { width: verticalWidth });
    const horizontal = createBarcodeSvg(FULL_RECORD, { layout: "horizontal", width });
    expect(horizontal.content).toBe(vertical.content);
    expect(horizontal.errorCorrectionLevel).toBe(vertical.errorCorrectionLevel);
    expect(horizontal.qrVersion).toBe(vertical.qrVersion);
    expect(horizontal.modulePx).toBe(vertical.modulePx);
    expect(horizontal.degraded).toBe(vertical.degraded);
  });

  it("keeps the white gap before the frame as wide as the vertical gap", () => {
    const { svg, qrVersion } = createBarcodeSvg(FULL_RECORD, { layout: "horizontal" });
    expect(qrVersion).toBeGreaterThanOrEqual(10);
    expect(svg).toContain('<rect x="0" y="0" width="103" height="96" fill="#FFFFFF"/>');
    const moduleSize = 96 / (17 + 4 * qrVersion);
    expect(QR_GAP / moduleSize).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  it("rejects widths below the horizontal minimum", () => {
    expect(() => createBarcodeSvg(PARTS, { layout: "horizontal", width: 939 })).toThrow(
      "at least 940",
    );
    expect(createBarcodeSvg(PARTS, { layout: "horizontal", width: 1410 }).height).toBe(720);
  });

  it("rejects an unknown layout", () => {
    expect(() => createBarcodeSvg(PARTS, { layout: "diagonal" } as never)).toThrow(
      'layout must be "vertical" or "horizontal"',
    );
  });

  it("hard-errors at the same payload length as the vertical badge", () => {
    const parts = { ...PARTS, encryptedPii: Buffer.from("a".repeat(2900), "base64url") };
    const error = capacityErrorFrom(() => createBarcodeSvg(parts, { layout: "horizontal" }));
    expect(error.reason).toBe("frame-fit");
    expect(error.badgeWidth).toBe(940);

    const longestFittable = { ...PARTS, encryptedPii: Buffer.from("a".repeat(2500), "base64url") };
    expect(createBarcodeSvg(longestFittable, { layout: "horizontal" }).errorCorrectionLevel).toBe(
      "L",
    );
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
