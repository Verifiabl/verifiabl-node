import { formatP1, p1FieldsSchema, parseP1 } from "../p1.js";

describe("formatP1", () => {
  it("formats the documented example exactly", () => {
    const result = formatP1({
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
    expect(formatP1({ employee_name: "Jane", bsb: "062-000" })).toBe("P1|Jane||||062-000||");
  });

  it("produces 8 segments even with no fields", () => {
    expect(formatP1({}).split("|")).toHaveLength(8);
  });

  it("rejects pipe characters in field values", () => {
    expect(() => formatP1({ employee_name: "Jane|Doe" })).toThrow();
  });

  it("rejects control characters in field values", () => {
    expect(() => formatP1({ position: "Dev\nOps" })).toThrow();
    expect(() => formatP1({ position: "Dev\tOps" })).toThrow();
    expect(() => formatP1({ position: "Dev\u0085Ops" })).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => p1FieldsSchema.parse({ tax_file_number: "123" })).toThrow();
  });

  it("rejects fields over 256 characters", () => {
    expect(() => formatP1({ employee_name: "x".repeat(257) })).toThrow();
  });

  it("accepts unicode names", () => {
    expect(formatP1({ employee_name: "Zoë O'Brien-Nguyễn" })).toContain("Zoë O'Brien-Nguyễn");
  });
});

describe("parseP1", () => {
  it("round-trips formatP1 output", () => {
    const fields = {
      employee_name: "Jane A. Doe",
      department: "Engineering",
      account_number: "12345678",
    };
    expect(parseP1(formatP1(fields))).toEqual(fields);
  });

  it("omits empty segments like the verifier does", () => {
    expect(parseP1("P1|Jane||||||")).toEqual({ employee_name: "Jane" });
  });

  it("rejects non-P1 strings", () => {
    expect(() => parseP1("P2|a|b|c|d|e|f|g")).toThrow("expected 'P1|' prefix");
  });

  it("rejects wrong field counts", () => {
    expect(() => parseP1("P1|only|three|fields")).toThrow("Expected 7 P1 fields but got 3");
  });
});
