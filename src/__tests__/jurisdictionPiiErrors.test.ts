import { ZodError } from "zod";
import {
  type AustralianPiiFields,
  formatAustralianPii,
  formatNewZealandPii,
  type NewZealandPiiFields,
  type PiiFieldViolation,
  PiiValidationError,
} from "../pii.js";

const profiles = [
  {
    name: "AU2",
    format: (input: unknown) => formatAustralianPii(input as AustralianPiiFields),
    fields: [
      "employeeName",
      "position",
      "department",
      "employerName",
      "employerAbn",
      "bsb",
      "accountNumber",
      "accountName",
    ],
    addressParts: ["suburb", "stateOrTerritory", "postcode"],
  },
  {
    name: "NZ2",
    format: (input: unknown) => formatNewZealandPii(input as NewZealandPiiFields),
    fields: [
      "employeeName",
      "irdNumber",
      "position",
      "department",
      "employerName",
      "accountNumber",
      "accountName",
    ],
    addressParts: ["suburb", "city", "postcode"],
  },
] as const;

const invalidText = [
  { value: "Synthetic|Value", reason: "pipe" },
  { value: "Synthetic\nValue", reason: "control-character" },
  { value: "Synthetic\u2028Value", reason: "control-character" },
  { value: "Synthetic\u2029Value", reason: "control-character" },
  { value: "Synthetic\u202eValue", reason: "format-character" },
  { value: "Synthetic\ud800Value", reason: "invalid-unicode" },
  { value: "Synthetic\udc00Value", reason: "invalid-unicode" },
] as const;

function expectViolations(
  action: () => string,
  violations: readonly PiiFieldViolation[],
  forbiddenValue: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PiiValidationError);
  const error = caught as PiiValidationError;
  expect(error.violations).toEqual(violations);
  expect(error.message).not.toContain(forbiddenValue);
  for (const { field } of violations) expect(error.message).toContain(field);
}

for (const { name, format, fields, addressParts } of profiles) {
  describe(`${name} PII errors`, () => {
    for (const field of fields) {
      it.each(invalidText)(`${field}: reports $reason without the value`, ({ value, reason }) => {
        expectViolations(() => format({ [field]: value }), [{ field, reason }], value);
      });
    }

    for (const part of addressParts) {
      it.each(invalidText)(
        `address.${part}: reports $reason without the value`,
        ({ value, reason }) => {
          expectViolations(
            () => format({ address: { [part]: value } }),
            [{ field: `address.${part}`, reason }],
            value,
          );
        },
      );
    }

    it.each(invalidText)("identifies the address line for $reason", ({ value, reason }) => {
      expectViolations(
        () => format({ address: { lines: ["Valid line", value] } }),
        [{ field: "address.lines[1]", reason }],
        value,
      );
    });

    it("collects violations in input-schema order, including each address line", () => {
      expectViolations(
        () =>
          format({
            address: { postcode: "Bad\u202ePostcode", lines: ["Bad|Line", "Bad\nLine"] },
            accountName: "Bad\ud800Name",
            employeeName: "Synthetic|Value",
          }),
        [
          { field: "employeeName", reason: "pipe" },
          { field: "accountName", reason: "invalid-unicode" },
          { field: "address.lines[0]", reason: "pipe" },
          { field: "address.lines[1]", reason: "control-character" },
          { field: "address.postcode", reason: "format-character" },
        ],
        "Synthetic|Value",
      );
    });

    it.each([
      null,
      undefined,
      "not an object",
      [],
      { employeeName: 42 },
      { employeeName: null },
      { unknownField: "Synthetic|Value" },
      { address: "Synthetic|Value" },
      { address: null },
      { address: [] },
      { address: { lines: "Synthetic|Value" } },
      { address: { lines: [42] } },
      { address: { lines: [null] } },
      { address: { suburb: 42 } },
      { address: { unknownPart: "Synthetic|Value" } },
    ])("preserves ZodError for malformed structures: %j", (input) => {
      expect(() => format(input)).toThrow(ZodError);
    });

    it("reports forbidden text before structural errors", () => {
      expectViolations(
        () => format({ employeeName: "Synthetic|Value", address: { lines: [42] } }),
        [{ field: "employeeName", reason: "pipe" }],
        "Synthetic|Value",
      );
    });

    it("does not change RangeError at the UTF-8 size boundary", () => {
      expect(Buffer.byteLength(format({ employeeName: "a".repeat(1013) }), "utf8")).toBe(1024);
      expect(() => format({ employeeName: "a".repeat(1014) })).toThrow(RangeError);
    });
  });
}

it("validates the AU employer name even when the ABN takes precedence", () => {
  expectViolations(
    () => formatAustralianPii({ employerAbn: "12345678901", employerName: "Synthetic|Value" }),
    [{ field: "employerName", reason: "pipe" }],
    "Synthetic|Value",
  );
});
