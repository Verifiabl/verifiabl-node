import { formatPii, PiiValidationError, parsePii, piiFieldsSchema } from "../pii.js";

describe("formatPii", () => {
  it("formats the documented example exactly", () => {
    const result = formatPii({
      employeeName: "Jane A. Doe",
      position: "Senior Developer",
      department: "Engineering",
      employerAbn: "12-345-678-901",
      bsb: "062-000",
      accountNumber: "12345678",
      accountName: "Jane A Doe",
      address: "12 Example St, Sydney NSW 2000",
    });
    expect(result).toBe(
      "P2|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe|12 Example St, Sydney NSW 2000",
    );
  });

  it("encodes omitted fields as empty segments", () => {
    expect(formatPii({ employeeName: "Jane", bsb: "062-000" })).toBe("P2|Jane||||062-000|||");
  });

  it("produces 9 segments even with no fields", () => {
    expect(formatPii({}).split("|")).toHaveLength(9);
  });

  it("rejects pipe characters in field values", () => {
    expect(() => formatPii({ employeeName: "Jane|Doe" })).toThrow(PiiValidationError);
  });

  it("reports violations in the address field too", () => {
    try {
      formatPii({ address: "12 Example St\nSydney NSW 2000" });
      throw new Error("expected formatPii to throw");
    } catch (error) {
      expect((error as PiiValidationError).violations).toEqual([
        { field: "address", reason: "control-character" },
      ]);
    }
  });

  it("rejects control characters in field values", () => {
    expect(() => formatPii({ position: "Dev\nOps" })).toThrow(PiiValidationError);
    expect(() => formatPii({ position: "Dev\tOps" })).toThrow(PiiValidationError);
    expect(() => formatPii({ position: "Dev\u0085Ops" })).toThrow(PiiValidationError);
  });

  it("rejects the line separators that are not control characters", () => {
    // U+2028 and U+2029 are Zl/Zp, so a Cc-only check would let them through.
    expect(() => formatPii({ address: "12 Example St\u2028Sydney" })).toThrow(PiiValidationError);
    expect(() => formatPii({ address: "12 Example St\u2029Sydney" })).toThrow(PiiValidationError);
  });

  it("names the offending field and reason without echoing the value", () => {
    try {
      formatPii({ employeeName: "Jane", accountName: "ACME|Trading" });
      throw new Error("expected formatPii to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PiiValidationError);
      const violations = (error as PiiValidationError).violations;
      expect(violations).toEqual([{ field: "accountName", reason: "pipe" }]);
      // The value itself is PII and must never appear in the message.
      expect((error as PiiValidationError).message).not.toContain("ACME|Trading");
      expect((error as PiiValidationError).message).toContain("accountName");
    }
  });

  it("reports every offending field in one error", () => {
    try {
      formatPii({ employeeName: "a|b", position: "x".repeat(257) });
      throw new Error("expected formatPii to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PiiValidationError);
      expect((error as PiiValidationError).violations).toEqual([
        { field: "employeeName", reason: "pipe" },
        { field: "position", reason: "too-long" },
      ]);
    }
  });

  it("rejects unknown fields", () => {
    expect(() => piiFieldsSchema.parse({ tax_file_number: "123" })).toThrow();
  });

  it("leaves nullish input to the schema (ZodError, not TypeError)", () => {
    for (const bad of [null, undefined]) {
      try {
        formatPii(bad as never);
        throw new Error("expected formatPii to throw");
      } catch (error) {
        expect((error as Error).name).toBe("ZodError");
      }
    }
  });

  it("rejects fields over 256 characters", () => {
    expect(() => formatPii({ employeeName: "x".repeat(257) })).toThrow(PiiValidationError);
  });

  it("accepts unicode names", () => {
    expect(formatPii({ employeeName: "Zoë O'Brien-Nguyễn" })).toContain("Zoë O'Brien-Nguyễn");
  });
});

describe("parsePii", () => {
  it("round-trips formatPii output", () => {
    const fields = {
      employeeName: "Jane A. Doe",
      department: "Engineering",
      accountNumber: "12345678",
      address: "12 Example St, Sydney NSW 2000",
    };
    expect(parsePii(formatPii(fields))).toEqual(fields);
  });

  it("omits empty segments like Verifiabl does", () => {
    expect(parsePii("P2|Jane|||||||")).toEqual({ employeeName: "Jane" });
  });

  it("treats an empty P2 address as an omitted field", () => {
    expect(parsePii("P2|Jane|||||||")).not.toHaveProperty("address");
  });

  it("still reads P1, which documents issued before P2 carry", () => {
    expect(parsePii("P1|Jane A. Doe||||||Jane A Doe")).toEqual({
      employeeName: "Jane A. Doe",
      accountName: "Jane A Doe",
    });
  });

  it("rejects unsupported wire versions", () => {
    expect(() => parsePii("P3|a|b|c|d|e|f|g|h")).toThrow("expected 'P1|' or 'P2|' prefix");
  });

  it("rejects wrong field counts", () => {
    expect(() => parsePii("P2|only|three|fields")).toThrow("Expected 8 P2 fields but got 3");
    expect(() => parsePii("P1|only|three|fields")).toThrow("Expected 7 P1 fields but got 3");
  });

  it("rejects a P2 payload missing the address segment rather than reading it as P1", () => {
    expect(() => parsePii("P2|a|b|c|d|e|f|g")).toThrow("Expected 8 P2 fields but got 7");
  });
});
