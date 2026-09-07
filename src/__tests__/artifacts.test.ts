import {
  buildBarcodePayload,
  createBarcodeArtifacts,
  createBarcodePng,
  createBarcodeSvg,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PROPERTY,
} from "../index.js";

const PARTS = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w",
};

describe("createBarcodeArtifacts", () => {
  it("returns the matching SVG and XMP metadata by default", async () => {
    const options = { environment: "sandbox" as const };
    const result = await createBarcodeArtifacts(PARTS, options);
    const expectedSvg = createBarcodeSvg(PARTS, options);

    expect(result.barcode).toMatchObject({
      format: "svg",
      data: Buffer.from(expectedSvg.svg, "utf8"),
      content: expectedSvg.content,
      width: expectedSvg.width,
      height: expectedSvg.height,
    });
    expect(result.pdfMetadata).toEqual({
      xmpNamespace: PDF_PAYLOAD_XMP_NAMESPACE,
      xmpProperty: PDF_PAYLOAD_XMP_PROPERTY,
      payload: buildBarcodePayload(PARTS),
    });
    expect(result.barcode.content.split("#2.")[1]).toBe(result.pdfMetadata.payload.split("|")[2]);
  });

  it("returns PNG bytes at the requested width", async () => {
    const options = { imageFormat: "png" as const, pixelWidth: 480 };
    const result = await createBarcodeArtifacts(PARTS, options);
    const expectedPng = await createBarcodePng(PARTS, {}, 480);

    expect(result.barcode).toMatchObject({
      format: "png",
      data: expectedPng.png,
      width: 480,
      height: expectedPng.height,
      content: expectedPng.content,
    });
  });

  it("applies the same rollback format to the QR and XMP copies", async () => {
    const result = await createBarcodeArtifacts(PARTS, { format: "v1", imageFormat: "png" });

    expect(result.barcode.content).toContain("#1.");
    expect(result.pdfMetadata.payload).toBe(buildBarcodePayload(PARTS, { format: "v1" }));
  });
});
