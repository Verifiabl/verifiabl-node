import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAustralianPii,
  formatNewZealandPii,
  PII_TEXT_PROFILE_UNICODE_VERSION,
  PiiValidationError,
} from "../pii.js";

interface PiiTextProfile {
  profileId: string;
  unicodeVersion: string;
  controlCharacterRanges: Array<[string, string]>;
  lineSeparatorCodePoints: string[];
  formatCharacterRanges: Array<[string, string]>;
}

interface PiiTextProfileVectors {
  profileId: string;
  validText: Array<{ name: string; value: string }>;
  invalidText: Array<{ name: string; codePoints: string[]; reason: string }>;
  invalidUtf16: Array<{ name: string; codeUnits: number[] }>;
}

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const textProfile = JSON.parse(
  readFileSync(join(fixturesDirectory, "p2-pii-text-profile-v1.json"), "utf8"),
) as PiiTextProfile;
const textProfileVectors = JSON.parse(
  readFileSync(join(fixturesDirectory, "p2-pii-text-profile-v1-vectors.json"), "utf8"),
) as PiiTextProfileVectors;

// AU2 and NZ2 apply the shared PII text profile to every field.
const formatters = [
  { name: "AU2", format: (employeeName: string) => formatAustralianPii({ employeeName }) },
  { name: "NZ2", format: (employeeName: string) => formatNewZealandPii({ employeeName }) },
] as const;

function codePointRange([startHex, endHex]: [string, string]): number[] {
  const start = Number.parseInt(startHex, 16);
  const end = Number.parseInt(endHex, 16);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

describe("shared PII text profile", () => {
  it("matches the canonical text-profile identity", () => {
    expect(textProfileVectors.profileId).toBe(textProfile.profileId);
    expect(PII_TEXT_PROFILE_UNICODE_VERSION).toBe(textProfile.unicodeVersion);
  });

  describe.each(formatters)("$name", ({ format }) => {
    it("rejects every canonical control and line-separator code point", () => {
      for (const range of textProfile.controlCharacterRanges) {
        for (const codePoint of codePointRange(range)) {
          expect(() => format(String.fromCodePoint(codePoint))).toThrow(PiiValidationError);
        }
      }
      for (const codePointHex of textProfile.lineSeparatorCodePoints) {
        expect(() => format(String.fromCodePoint(Number.parseInt(codePointHex, 16)))).toThrow(
          PiiValidationError,
        );
      }
    });

    it("rejects every canonical Unicode 17.0 format-character range", () => {
      for (const range of textProfile.formatCharacterRanges) {
        for (const codePoint of codePointRange(range)) {
          expect(() => format(String.fromCodePoint(codePoint))).toThrow(PiiValidationError);
        }
      }
    });

    it.each(textProfileVectors.validText)("accepts canonical text vector: $name", ({ value }) => {
      expect(format(value)).toContain(value);
    });

    it.each(textProfileVectors.invalidText)(
      "rejects canonical text vector: $name",
      ({ codePoints, reason }) => {
        const value = String.fromCodePoint(
          ...codePoints.map((value) => Number.parseInt(value, 16)),
        );
        let caught: unknown;
        try {
          format(value);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(PiiValidationError);
        const expectedReason = reason === "line-separator" ? "control-character" : reason;
        expect((caught as PiiValidationError).violations).toEqual([
          { field: "employeeName", reason: expectedReason },
        ]);
      },
    );

    it.each(textProfileVectors.invalidUtf16)(
      "rejects canonical malformed UTF-16 vector: $name",
      ({ codeUnits }) => {
        expect(() => format(String.fromCharCode(...codeUnits))).toThrow(PiiValidationError);
      },
    );

    it("accepts fields over the former 256 UTF-16-code-unit limit", () => {
      expect(format("x".repeat(257))).toContain("x".repeat(257));
    });

    it("accepts unicode names without normalizing them", () => {
      expect(format("Zoë O'Brien-Nguyễn")).toContain("Zoë O'Brien-Nguyễn");
    });
  });

  it("preserves a realistic international address line verbatim", () => {
    const line = "12 Rue de l’Église, Apt 4B 🇫🇷";
    expect(formatAustralianPii({ address: { lines: [line] } })).toBe(`AU2||||||||${line}`);
    expect(formatNewZealandPii({ address: { lines: [line] } })).toBe(`NZ2||||||||${line}`);
  });

  it("accepts addresses over the former 320 UTF-8-byte limit", () => {
    const line = "x".repeat(321);
    expect(formatAustralianPii({ address: { lines: [line] } }).endsWith(`|${line}`)).toBe(true);
  });

  it("rejects the line separators that are not control characters", () => {
    // U+2028 and U+2029 are Zl/Zp, so a Cc-only check would let them through.
    for (const separator of [" ", " "]) {
      expect(() =>
        formatAustralianPii({ address: { lines: [`12 Example St${separator}Sydney`] } }),
      ).toThrow(PiiValidationError);
    }
  });

  it("leaves nullish input to the schema (ZodError, not TypeError)", () => {
    for (const format of [formatAustralianPii, formatNewZealandPii]) {
      for (const bad of [null, undefined]) {
        let caught: unknown;
        try {
          format(bad as never);
        } catch (error) {
          caught = error;
        }
        expect((caught as Error).name).toBe("ZodError");
      }
    }
  });

  it("rejects unknown fields", () => {
    expect(() => formatAustralianPii({ tax_file_number: "123" } as never)).toThrow();
    expect(() => formatNewZealandPii({ tax_file_number: "123" } as never)).toThrow();
  });
});
