import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registrationToWire } from "../types.js";

const vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/v2-wire-vectors-v1.json"),
    "utf8",
  ),
) as {
  format: string;
  cases: { id: string; schema: string; payslip_non_pii: Record<string, unknown> }[];
};
const encryptionMetadata = { iv: new Uint8Array(12), tag: new Uint8Array(16) };

// Construct inputs in the public Node shape; never feed the wire expectation to the mapper.
const inputs = {
  "au-codes-and-earnings": {
    schema: "au.payslip.v2" as const,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    paymentDate: "2026-09-04",
    currency: "AUD",
    gross: "9000.00",
    paygw: "2250.00",
    net: "6750.00",
    payFrequency: "monthly",
    employmentBasis: "full_time",
    earnings: [
      { type: "ordinary", amount: "8987.50" },
      { type: "allowance", amount: "12.50", allowanceType: "other", otherCategory: "home_office" },
    ],
  },
  "nz-leave-and-dates": {
    schema: "nz.payslip.v2" as const,
    periodEnd: "2026-08-31",
    paymentDate: "2026-09-04",
    currency: "NZD",
    gross: "7600.00",
    paye: "1710.00",
    net: "5890.00",
    earnings: [
      { type: "paid_leave", leaveType: "annual_holiday", amount: "7000.00" },
      { type: "overtime", amount: "600.00", units: "10.0", rate: "60.00" },
    ],
    leaveBalances: { annual: { amount: "76.50", unit: "hours" } },
  },
} as const;

describe("shared v2 wire vectors", () => {
  it("covers every canonical case with an ecosystem-native input", () => {
    expect(vectors.format).toBe("verifiabl-v2-wire-vectors-v1");
    expect(vectors.cases.map(({ id }) => id).sort()).toEqual(Object.keys(inputs).sort());
  });

  for (const [id, input] of Object.entries(inputs)) {
    it(`serializes ${id} without changing dates, codes or decimal scale`, () => {
      const { schema, ...payslipNonPii } = input;
      const expected = vectors.cases.find((item) => item.id === id);
      if (!expected) throw new Error(`Missing vector ${id}`);
      expect(schema).toBe(expected.schema);
      const body = registrationToWire({
        schema,
        issuedAt: "2026-09-04T00:00:00Z",
        payslipNonPii: payslipNonPii as never,
        encryptionMetadata,
      });
      expect(body.payslip_non_pii).toEqual(expected.payslip_non_pii);
    });
  }
});
