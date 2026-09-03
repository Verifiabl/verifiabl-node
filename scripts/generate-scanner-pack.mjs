// Generate synthetic, deterministic v2 symbols for the VER-460 physical scanner matrix.
// The output is test evidence, not production data. Never replace these values with customer PII.
import { createCipheriv } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildBarcodePayload,
  createBarcodePng,
  formatPiiV2,
} from "../dist/index.js";

const outputDirectory = resolve(process.argv[2] ?? "artifacts/scanner-pack");
const key = Buffer.from([...Array(32).keys()]);
const sharedFields = {
  employeeName: "Zoë Nguyễn",
  position: "Ingénieure systèmes",
  department: "R&D International",
  employerAbn: "53004085616",
  bsb: "062-000",
  accountNumber: "12345678",
  accountName: "Zoë Nguyễn",
};
const fixtures = [
  {
    id: "representative-no-address",
    description: "Representative P2 payload with the optional address absent",
    reference: "u0FE9WLIS7GYKQnpJPygBw",
    fields: sharedFields,
  },
  {
    id: "international-address",
    description: "Realistic international P2 address",
    reference: "AbCdEfGhIjKlMnOpQrStUv",
    fields: {
      ...sharedFields,
      address: "12 Rue de l’Église, Apt 4B, 75005 Paris, France 🇫🇷",
    },
  },
  {
    id: "address-320-bytes",
    description: "Exact 320-byte UTF-8 P2 address boundary",
    reference: "42Bb_14sjC-UPUVshbjjSg",
    fields: { ...sharedFields, address: `${"東京".repeat(53)}AB` },
  },
];

function encryptDeterministically(plaintext, index) {
  // Fixed synthetic key and distinct fixed IVs make the pack reproducible across SDKs.
  // This helper is test-only. Production encryption must use a fresh random IV.
  const iv = Buffer.alloc(12);
  iv[11] = index + 1;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await mkdir(outputDirectory, { recursive: true });

const manifestFixtures = [];
for (const [index, fixture] of fixtures.entries()) {
  const plaintext = formatPiiV2(fixture.fields);
  const ciphertextBytes = encryptDeterministically(plaintext, index);
  const encryptedPii = ciphertextBytes.toString("base64url");
  const parts = { verifiablReference: fixture.reference, encryptedPii };
  const barcode = await createBarcodePng(
    parts,
    { format: "v2", environment: "sandbox", maxErrorCorrection: "M" },
    720,
  );
  const pngFile = `${fixture.id}.png`;
  await writeFile(resolve(outputDirectory, pngFile), barcode.png);

  manifestFixtures.push({
    id: fixture.id,
    description: fixture.description,
    addressUtf8Bytes: Buffer.byteLength(fixture.fields.address ?? "", "utf8"),
    plaintextUtf8Bytes: Buffer.byteLength(plaintext, "utf8"),
    verifiablReference: fixture.reference,
    ciphertext: {
      byteLength: ciphertextBytes.length,
      base64url: encryptedPii,
      hex: ciphertextBytes.toString("hex"),
    },
    qr: {
      file: pngFile,
      content: barcode.content,
      version: barcode.qrVersion,
      errorCorrectionLevel: barcode.errorCorrectionLevel,
      width: barcode.width,
      height: barcode.height,
      segments: ["byte", "alphanumeric"],
    },
    xmpPayload: buildBarcodePayload(parts, { format: "v2" }),
  });
}

const manifest = {
  format: "verifiabl-scanner-pack-v1",
  syntheticDataOnly: true,
  environment: "sandbox",
  fixtures: manifestFixtures,
};
await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const cards = manifestFixtures
  .map(
    (fixture) => `
      <article class="fixture">
        <h2>${escapeHtml(fixture.id)}</h2>
        <p>${escapeHtml(fixture.description)}</p>
        <img src="${escapeHtml(fixture.qr.file)}" alt="${escapeHtml(fixture.id)} QR fixture">
        <dl>
          <dt>QR</dt><dd>Version ${fixture.qr.version}, ECC ${fixture.qr.errorCorrectionLevel}</dd>
          <dt>Address</dt><dd>${fixture.addressUtf8Bytes} UTF-8 bytes</dd>
          <dt>Reference</dt><dd><code>${escapeHtml(fixture.verifiablReference)}</code></dd>
          <dt>Expected scan</dt><dd><code>${escapeHtml(fixture.qr.content)}</code></dd>
        </dl>
        <div class="fold-guide">Fold guide: fold on this line, away from the QR, for the fold test.</div>
      </article>`,
  )
  .join("\n");
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verifiabl VER-460 scanner pack</title>
  <style>
    body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
    .notice { padding: 12px; border: 2px solid #010a4f; margin-bottom: 24px; }
    .fixture { break-after: page; page-break-after: always; max-width: 760px; }
    img { display: block; width: 45mm; height: auto; margin: 16px 0; image-rendering: pixelated; }
    dt { font-weight: 700; float: left; clear: left; width: 110px; }
    dd { margin-left: 120px; margin-bottom: 8px; overflow-wrap: anywhere; }
    code { font: 11px/1.3 ui-monospace, monospace; }
    .fold-guide { clear: both; margin-top: 30mm; border-top: 1px dashed #555; padding-top: 4px; }
    @media print { body { margin: 12mm; } .fixture { max-width: none; } }
  </style>
</head>
<body>
  <div class="notice"><strong>Synthetic test data only.</strong> Compare scanner output with manifest.json. Do not use customer payslips.</div>
  ${cards}
</body>
</html>
`;
await writeFile(resolve(outputDirectory, "index.html"), html);
console.log(`Wrote ${manifestFixtures.length} scanner fixtures to ${outputDirectory}`);
