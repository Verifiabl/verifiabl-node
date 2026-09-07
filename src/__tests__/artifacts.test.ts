import {
  buildBarcodePayload,
  createBarcodeArtifacts,
  createBarcodeSvg,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PROPERTY,
} from "../index.js";

const PARTS = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w",
};

describe("createBarcodeArtifacts", () => {
  it("returns the matching SVG barcode and XMP metadata in one call", () => {
    const options = { environment: "sandbox" as const };
    const result = createBarcodeArtifacts(PARTS, options);

    expect(result.barcode).toEqual(createBarcodeSvg(PARTS, options));
    expect(result.pdfMetadata).toEqual({
      xmpNamespace: PDF_PAYLOAD_XMP_NAMESPACE,
      xmpProperty: PDF_PAYLOAD_XMP_PROPERTY,
      payload: buildBarcodePayload(PARTS),
    });
    expect(result.barcode.content.split("#2.")[1]).toBe(result.pdfMetadata.payload.split("|")[2]);
  });

  it("applies the same rollback format to the QR and XMP copies", () => {
    const result = createBarcodeArtifacts(PARTS, { format: "v1" });

    expect(result.barcode.content).toContain("#1.");
    expect(result.pdfMetadata.payload).toBe(buildBarcodePayload(PARTS, { format: "v1" }));
  });
});
