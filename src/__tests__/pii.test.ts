import { formatPii, parsePii, piiFieldsSchema } from "../pii.js";

describe("formatPii", () => {
  it("formats the documented example exactly", () => {
    const result = formatPii({
      employee_name: "Jane A. Doe",
      position: "Senior Developer",
      department: "Engineering",
      employer_abn: "12-345-678-901",
      bsb: "062-000",
      account_number: "12345678",
      account_name: "Jane A Doe",
    });
    expect(result).toBe(
      "P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe",
    );
  });

  it("encodes omitted fields as empty segments", () => {
    expect(formatPii({ employee_name: "Jane", bsb: "062-000" })).toBe("P1|Jane||||062-000||");
  });

  it("produces 8 segments even with no fields", () => {
    expect(formatPii({}).split("|")).toHaveLength(8);
  });

  it("rejects pipe characters in field values", () => {
    expect(() => formatPii({ employee_name: "Jane|Doe" })).toThrow();
  });

  it("rejects control characters in field values", () => {
    expect(() => formatPii({ position: "Dev\nOps" })).toThrow();
    expect(() => formatPii({ position: "Dev\tOps" })).toThrow();
    expect(() => formatPii({ position: "Dev\u0085Ops" })).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => piiFieldsSchema.parse({ tax_file_number: "123" })).toThrow();
  });

  it("rejects fields over 256 characters", () => {
    expect(() => formatPii({ employee_name: "x".repeat(257) })).toThrow();
  });

  it("accepts unicode names", () => {
    expect(formatPii({ employee_name: "Zoë O'Brien-Nguyễn" })).toContain("Zoë O'Brien-Nguyễn");
  });
});

describe("parsePii", () => {
  it("round-trips formatPii output", () => {
    const fields = {
      employee_name: "Jane A. Doe",
      department: "Engineering",
      account_number: "12345678",
    };
    expect(parsePii(formatPii(fields))).toEqual(fields);
  });

  it("omits empty segments like Verifiabl does", () => {
    expect(parsePii("P1|Jane||||||")).toEqual({ employee_name: "Jane" });
  });

  it("rejects unsupported wire versions", () => {
    expect(() => parsePii("P2|a|b|c|d|e|f|g")).toThrow("expected 'P1|' prefix");
  });

  it("rejects wrong field counts", () => {
    expect(() => parsePii("P1|only|three|fields")).toThrow("Expected 7 PII fields but got 3");
  });
});
