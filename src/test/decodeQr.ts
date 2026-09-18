import { readBarcodes, ZXING_CPP_COMMIT } from "zxing-wasm/reader";

const EXPECTED_ZXING_CPP_COMMIT = "0b2d9a8fc81f420f369928c24331091ff0525976";

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
