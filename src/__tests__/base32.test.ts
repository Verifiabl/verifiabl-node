import { encodeBase32, getBase32EncodedLength } from "../base32.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_BITS_PER_CHARACTER = 5;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;

function decodeBase32ForTest(value: string): Buffer {
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of value) {
    const encoded = BASE32_ALPHABET.indexOf(character);
    if (encoded < 0) throw new Error(`invalid test Base32 character: ${character}`);
    accumulator = (accumulator << BASE32_BITS_PER_CHARACTER) | encoded;
    bits += BASE32_BITS_PER_CHARACTER;
    while (bits >= BYTE_BITS) {
      bits -= BYTE_BITS;
      bytes.push((accumulator >>> bits) & BYTE_MASK);
    }
    accumulator &= (1 << bits) - 1;
  }

  return Buffer.from(bytes);
}

describe("encodeBase32", () => {
  it.each([
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("matches RFC 4648 section 10 for %s", (plaintext, expected) => {
    expect(encodeBase32(Buffer.from(plaintext, "ascii"))).toBe(expected);
  });

  it("encodes empty input as empty output", () => {
    expect(encodeBase32(Buffer.alloc(0))).toBe("");
  });

  it.each([
    [[0x00], "AA"],
    [[0x01], "AE"],
    [[0xff], "74"],
    [[0xff, 0x00], "74AA"],
    [[0xff, 0xff], "777Q"],
    [[0xff, 0xff, 0xff], "77776"],
    [[0xff, 0xff, 0xff, 0xff], "777777Y"],
    [[0xff, 0xff, 0xff, 0xff, 0xff], "77777777"],
    [[0x00, 0x01, 0x02, 0x03, 0x04], "AAAQEAYE"],
  ])("handles terminal-bit case %#", (bytes, expected) => {
    expect(encodeBase32(Buffer.from(bytes))).toBe(expected);
  });

  it("emits canonical uppercase text without padding", () => {
    expect(encodeBase32(Buffer.from([0xff, 0x00, 0x01]))).toBe("74AAC");
  });

  it("round-trips varied byte lengths through an independent decoder", () => {
    for (let length = 1; length <= 64; length++) {
      const bytes = Buffer.alloc(length);
      for (let index = 0; index < length; index++) {
        bytes[index] = (length * 31 + index * 17) & BYTE_MASK;
      }

      const encoded = encodeBase32(bytes);

      expect(encoded).toHaveLength(getBase32EncodedLength(length));
      expect(encoded).toMatch(/^[A-Z2-7]+$/);
      expect(decodeBase32ForTest(encoded)).toEqual(bytes);
    }
  });
});

describe("getBase32EncodedLength", () => {
  it.each([
    [0, 0],
    [1, 2],
    [2, 4],
    [3, 5],
    [4, 7],
    [5, 8],
    [268_435_456, 429_496_730],
  ])("calculates encoded length for %i bytes", (byteLength, expected) => {
    expect(getBase32EncodedLength(byteLength)).toBe(expected);
  });

  it("rejects invalid byte lengths", () => {
    expect(() => getBase32EncodedLength(-1)).toThrow("non-negative integer");
    expect(() => getBase32EncodedLength(1.5)).toThrow("non-negative integer");
    expect(() => getBase32EncodedLength(Number.MAX_SAFE_INTEGER)).toThrow("too large");
  });
});
