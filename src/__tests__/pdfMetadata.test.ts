import { deflateRawSync, deflateSync } from "node:zlib";
import { extractPayloadFromPdf } from "../pdfMetadata.js";

const PAYLOAD = "1|AbCdEfGhIjKlMnOpQrStUv|Zm9vYmFyYmF6cXV4";

function xmpPacket(body: string): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    ${body}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

const ELEMENT_FORM = xmpPacket(
  `<rdf:Description rdf:about="" xmlns:verifiabl="https://verifiabl.io/ns/">
      <verifiabl:payload>${PAYLOAD}</verifiabl:payload>
    </rdf:Description>`,
);

/** Minimal PDF-shaped bytes with an uncompressed /Metadata stream, as pdf-lib writes it. */
function pdfWithUncompressedMetadata(xmp: string): Uint8Array {
  const file = `%PDF-1.7
1 0 obj
<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>
stream
${xmp}
endstream
endobj
trailer
<< /Root 2 0 R >>
%%EOF`;
  return new TextEncoder().encode(file);
}

/** PDF-shaped bytes whose metadata stream is FlateDecode compressed. */
function pdfWithCompressedMetadata(
  xmp: string,
  options: { raw?: boolean; markDict?: boolean } = {},
): Uint8Array {
  const compressed = options.raw
    ? deflateRawSync(Buffer.from(xmp, "utf-8"))
    : deflateSync(Buffer.from(xmp, "utf-8"));
  const dictType = options.markDict === false ? "" : "/Type /Metadata /Subtype /XML ";
  const header = new TextEncoder().encode(`%PDF-1.7
1 0 obj
<< ${dictType}/Filter /FlateDecode /Length ${compressed.length} >>
stream
`);
  const footer = new TextEncoder().encode(`
endstream
endobj
%%EOF`);
  const bytes = new Uint8Array(header.length + compressed.length + footer.length);
  bytes.set(header, 0);
  bytes.set(compressed, header.length);
  bytes.set(footer, header.length + compressed.length);
  return bytes;
}

describe("extractPayloadFromPdf", () => {
  it("reads an uncompressed metadata stream (pdf-lib shape)", async () => {
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(ELEMENT_FORM))).resolves.toBe(
      PAYLOAD,
    );
  });

  it("accepts an ArrayBuffer input", async () => {
    const bytes = pdfWithUncompressedMetadata(ELEMENT_FORM);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    await expect(extractPayloadFromPdf(copy)).resolves.toBe(PAYLOAD);
  });

  it("reads a FlateDecode-compressed metadata stream", async () => {
    await expect(extractPayloadFromPdf(pdfWithCompressedMetadata(ELEMENT_FORM))).resolves.toBe(
      PAYLOAD,
    );
  });

  it("reads a raw-deflate compressed stream (non-conformant writer)", async () => {
    await expect(
      extractPayloadFromPdf(pdfWithCompressedMetadata(ELEMENT_FORM, { raw: true })),
    ).resolves.toBe(PAYLOAD);
  });

  it("falls back to unmarked FlateDecode streams", async () => {
    await expect(
      extractPayloadFromPdf(pdfWithCompressedMetadata(ELEMENT_FORM, { markDict: false })),
    ).resolves.toBe(PAYLOAD);
  });

  it("resolves any prefix bound to the Verifiabl namespace", async () => {
    const otherPrefix = xmpPacket(
      `<rdf:Description rdf:about="" xmlns:ns1="https://verifiabl.io/ns/">
      <ns1:payload>${PAYLOAD}</ns1:payload>
    </rdf:Description>`,
    );
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(otherPrefix))).resolves.toBe(
      PAYLOAD,
    );
  });

  it("reads XMP attribute-form serialisation", async () => {
    const attributeForm = xmpPacket(
      `<rdf:Description rdf:about="" xmlns:verifiabl="https://verifiabl.io/ns/" verifiabl:payload="${PAYLOAD}"/>`,
    );
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(attributeForm))).resolves.toBe(
      PAYLOAD,
    );
  });

  it("unescapes XML entities in the payload value", async () => {
    const escaped = xmpPacket(
      `<rdf:Description rdf:about="" xmlns:verifiabl="https://verifiabl.io/ns/">
      <verifiabl:payload>1|AbCdEfGhIjKlMnOpQrStUv|Zm9v&amp;YmFy&#x41;</verifiabl:payload>
    </rdf:Description>`,
    );
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(escaped))).resolves.toBe(
      "1|AbCdEfGhIjKlMnOpQrStUv|Zm9v&YmFyA",
    );
  });

  it("returns null for a PDF without Verifiabl metadata", async () => {
    const plain = xmpPacket(
      `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>Payslip</dc:title>
    </rdf:Description>`,
    );
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(plain))).resolves.toBeNull();
  });

  it("returns null for an empty payload element", async () => {
    const empty = xmpPacket(
      `<rdf:Description rdf:about="" xmlns:verifiabl="https://verifiabl.io/ns/">
      <verifiabl:payload>   </verifiabl:payload>
    </rdf:Description>`,
    );
    await expect(extractPayloadFromPdf(pdfWithUncompressedMetadata(empty))).resolves.toBeNull();
  });

  it("survives undecodable FlateDecode streams elsewhere in the file", async () => {
    const garbage = new TextEncoder().encode(`%PDF-1.7
1 0 obj
<< /Filter /FlateDecode /Length 8 >>
stream
notzlib!
endstream
endobj
`);
    const good = pdfWithCompressedMetadata(ELEMENT_FORM);
    const bytes = new Uint8Array(garbage.length + good.length);
    bytes.set(garbage, 0);
    bytes.set(good, garbage.length);
    await expect(extractPayloadFromPdf(bytes)).resolves.toBe(PAYLOAD);
  });
});
