const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BYTE_BITS = 8;
const BASE32_BITS_PER_CHARACTER = 5;
const BASE32_CHARACTER_MASK = 0b11111;

/** Number of unpadded RFC 4648 Base32 characters needed for a byte length. */
export function getBase32EncodedLength(byteLength: number): number {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new Error("byteLength must be a non-negative integer");
  }
  if (byteLength > Math.floor(Number.MAX_SAFE_INTEGER / BYTE_BITS)) {
    throw new Error("byteLength is too large to calculate safely");
  }
  return Math.ceil((byteLength * BYTE_BITS) / BASE32_BITS_PER_CHARACTER);
}

/** Encode bytes as canonical uppercase, unpadded RFC 4648 Base32. */
export function encodeBase32(input: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bits = 0;

  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += BYTE_BITS;
    while (bits >= BASE32_BITS_PER_CHARACTER) {
      bits -= BASE32_BITS_PER_CHARACTER;
      output += RFC4648_BASE32_ALPHABET[(accumulator >>> bits) & BASE32_CHARACTER_MASK];
    }
    // Only the carry bits below one Base32 character survive between bytes.
    accumulator &= (1 << bits) - 1;
  }

  if (bits > 0) {
    output +=
      RFC4648_BASE32_ALPHABET[
        (accumulator << (BASE32_BITS_PER_CHARACTER - bits)) & BASE32_CHARACTER_MASK
      ];
  }
  return output;
}

/** Decode and validate the SDK's canonical base64url ciphertext transport. */
export function decodeCanonicalBase64url(value: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    throw new Error("Ciphertext must be canonical unpadded base64url");
  }
  return bytes;
}
