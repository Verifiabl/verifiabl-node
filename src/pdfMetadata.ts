import { PDF_PAYLOAD_XMP_NAMESPACE } from "./payload.js";

/**
 * Reader-side counterpart of the PDF metadata failsafe: pull the
 * `verifiabl:payload` XMP property (namespace `https://verifiabl.io/ns/`) back
 * out of a payslip PDF's bytes, so the payload survives a cropped, redacted,
 * or unscannable QR code.
 *
 * This deliberately does not use a PDF library: general PDF readers routinely
 * miss custom `/Metadata` streams (pdfjs `getMetadata()` returns null for
 * pdf-lib-written ones), and pulling one property does not justify a heavy
 * dependency. Instead the bytes are scanned directly, handling both
 * uncompressed and FlateDecode-compressed metadata streams, XMP element and
 * attribute serialisation, and any namespace prefix bound to the Verifiabl
 * namespace.
 */

const STREAM_KEYWORD_RE = /stream(?:\r\n|\n|\r)/g;
// How far back from a `stream` keyword to look for its dictionary entries.
const DICT_LOOKBACK_CHARS = 2048;
// Ignore implausibly large candidate streams; XMP packets are a few KB.
const MAX_STREAM_BYTES = 5 * 1024 * 1024;

function xmlUnescape(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the payload property in an XMP (or XMP-containing) text blob.
 *
 * The prefix is resolved by namespace URI, not assumed to be `verifiabl`:
 * XMP serialisers may bind any prefix, and may write simple properties in
 * either element or attribute form.
 */
function findPayloadInXmp(text: string): string | null {
  const namespacePattern = escapeForRegex(PDF_PAYLOAD_XMP_NAMESPACE);
  const prefixRe = new RegExp(`xmlns:([A-Za-z0-9._-]+)\\s*=\\s*["']${namespacePattern}["']`, "g");

  for (const prefixMatch of text.matchAll(prefixRe)) {
    const boundPrefix = prefixMatch[1];
    if (!boundPrefix) continue;
    const prefix = escapeForRegex(boundPrefix);

    const elementRe = new RegExp(
      `<${prefix}:payload(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}:payload>`,
    );
    const elementMatch = text.match(elementRe);
    if (elementMatch) {
      const value = xmlUnescape(elementMatch[1] ?? "").trim();
      if (value.length > 0) return value;
    }

    const attributeRe = new RegExp(`[\\s"']${prefix}:payload\\s*=\\s*("([^"]*)"|'([^']*)')`);
    const attributeMatch = text.match(attributeRe);
    if (attributeMatch) {
      const value = xmlUnescape(attributeMatch[2] ?? attributeMatch[3] ?? "").trim();
      if (value.length > 0) return value;
    }
  }

  return null;
}

async function inflate(bytes: Uint8Array, format: "deflate" | "deflate-raw"): Promise<string> {
  // Copy the subarray view into a fresh buffer: Blob requires a plain
  // ArrayBuffer-backed view, and candidate streams are a few KB.
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  const inflated = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8").decode(inflated);
}

interface CandidateStream {
  bytes: Uint8Array;
  dictMentionsMetadata: boolean;
}

/**
 * Collect FlateDecode stream bodies from the raw file text. `latin1` maps each
 * byte to one char, so string indexes are byte offsets into `bytes`.
 */
function collectFlateStreams(text: string, bytes: Uint8Array): CandidateStream[] {
  const candidates: CandidateStream[] = [];

  for (const match of text.matchAll(STREAM_KEYWORD_RE)) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = text.indexOf("endstream", bodyStart);
    if (bodyEnd < 0 || bodyEnd - bodyStart > MAX_STREAM_BYTES) continue;

    const dict = text.slice(Math.max(0, match.index - DICT_LOOKBACK_CHARS), match.index);
    if (!dict.includes("/FlateDecode")) continue;

    // Writers put an EOL before `endstream`; trailing junk after the zlib
    // stream makes DecompressionStream throw, so trim it off.
    let trimmedEnd = bodyEnd;
    while (trimmedEnd > bodyStart && " \t\r\n".includes(text.charAt(trimmedEnd - 1))) {
      trimmedEnd -= 1;
    }

    candidates.push({
      bytes: bytes.subarray(bodyStart, trimmedEnd),
      dictMentionsMetadata: dict.includes("/Metadata") || dict.includes("/XML"),
    });
  }

  // Streams whose dictionary marks them as metadata are the likely hits;
  // try those first, but fall back to every FlateDecode stream so writers
  // with unusual dictionaries are still covered.
  return candidates.sort((a, b) => Number(b.dictMentionsMetadata) - Number(a.dictMentionsMetadata));
}

/**
 * Extract the Verifiabl barcode payload from a payslip PDF's XMP metadata.
 *
 * Returns the raw payload string (e.g. `1|<verifiablReference>|<ciphertext>`),
 * or null when the PDF carries no readable Verifiabl metadata. Feed the result
 * to `parseBarcode` to validate it and recover the parts.
 */
export async function extractPayloadFromPdf(
  bytes: Uint8Array | ArrayBuffer,
): Promise<string | null> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // latin1 is a 1:1 byte-to-char decoding, so compressed regions survive
  // as scannable (if meaningless) text and offsets stay byte-accurate.
  const text = new TextDecoder("latin1").decode(view);

  const direct = findPayloadInXmp(text);
  if (direct !== null) {
    return direct;
  }

  for (const candidate of collectFlateStreams(text, view)) {
    for (const format of ["deflate", "deflate-raw"] as const) {
      let inflated: string;
      try {
        inflated = await inflate(candidate.bytes, format);
      } catch {
        continue;
      }
      const payload = findPayloadInXmp(inflated);
      if (payload !== null) {
        return payload;
      }
      break; // inflated fine but no payload: no need to retry the other format
    }
  }

  return null;
}
