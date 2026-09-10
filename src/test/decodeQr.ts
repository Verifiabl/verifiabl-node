import { readBarcodes, ZXING_CPP_COMMIT } from "zxing-wasm/reader";

const EXPECTED_ZXING_CPP_COMMIT = "a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f";

if (ZXING_CPP_COMMIT !== EXPECTED_ZXING_CPP_COMMIT) {
  throw new Error("The packaged ZXing-C++ revision does not match the reviewed test pin");
}

export async function decodeQrImage(image: Uint8Array): Promise<string | null> {
  const results = await readBarcodes(image, {
    formats: ["QRCode"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  return results[0]?.text || null;
}
