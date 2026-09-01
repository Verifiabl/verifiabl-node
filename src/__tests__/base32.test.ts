import { encodeBase32 } from "../base32.js";

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

  it("emits canonical uppercase text without padding", () => {
    expect(encodeBase32(Buffer.from([0xff, 0x00, 0x01]))).toBe("74AAC");
  });
});
