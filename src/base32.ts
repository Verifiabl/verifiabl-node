const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes as canonical uppercase, unpadded RFC 4648 Base32. */
export function encodeBase32(input: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bits = 0;

  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += RFC4648_BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
    // No more than 12 significant bits need to survive between bytes.
    accumulator &= (1 << bits) - 1;
  }

  if (bits > 0) {
    output += RFC4648_BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
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
