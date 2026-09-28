import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { australianPayslipV2Schema, payslipNumber, supportedV2Currencies } from "../payslipV2.js";
import {
  AUSTRALIAN_PII_FIELD_ORDER,
  AUSTRALIAN_PII_TEXT_PROFILE_ID,
  type AustralianPiiFields,
  formatAustralianPii,
  formatNewZealandPii,
  NEW_ZEALAND_PII_FIELD_ORDER,
  NEW_ZEALAND_PII_TEXT_PROFILE_ID,
  type NewZealandPiiFields,
  PII_PAYLOAD_MAX_BYTES,
} from "../pii.js";
import {
  registerNonPiiBatchToWire,
  registerNonPiiRequestSchema,
  registrationToWire,
} from "../types.js";

const metadata = {
  iv: new Uint8Array(12),
  tag: new Uint8Array(16),
};

describe("AU2 and NZ2 encrypted PII", () => {
  it("formats AU2 in its permanent order and prefers the ABN", () => {
    expect(
      formatAustralianPii({
        employeeName: "Jo Worker",
        position: "Analyst",
        department: "Finance",
        employerName: "Acme Pty Ltd",
        employerAbn: "12 345 678 901",
        bsb: "062-000",
        accountNumber: "****5678",
        accountName: "J Worker",
        address: {
          lines: ["A204/11-17 Eve Street"],
          suburb: "Erskineville",
          stateOrTerritory: "NSW",
          postcode: "2043",
        },
      }),
    ).toBe(
      "AU2|Jo Worker|Analyst|Finance|12 345 678 901|062-000|****5678|J Worker|" +
        "A204/11-17 Eve Street, Erskineville NSW 2043",
    );
    expect(formatAustralianPii({ employerName: "Acme Pty Ltd" })).toBe("AU2||||Acme Pty Ltd||||");
  });

  it("formats NZ2 in its permanent order", () => {
    expect(
      formatNewZealandPii({
        employeeName: "Jo Worker",
        irdNumber: "***-***-789",
        position: "Analyst",
        department: "Finance",
        employerName: "Acme Limited",
        accountNumber: "**-****-****5678-**",
        accountName: "J Worker",
        address: {
          lines: ["Level 2", "10 Lambton Quay"],
          suburb: "Wellington Central",
          city: "Wellington",
          postcode: "6011",
        },
      }),
    ).toBe(
      "NZ2|Jo Worker|***-***-789|Analyst|Finance|Acme Limited|**-****-****5678-**|" +
        "J Worker|Level 2, 10 Lambton Quay, Wellington Central, Wellington 6011",
    );
  });

  it("preserves all positions and enforces the full payload limit", () => {
    expect(formatAustralianPii({})).toBe("AU2||||||||");
    expect(formatNewZealandPii({})).toBe("NZ2||||||||");
    const boundary = formatAustralianPii({ employeeName: "a".repeat(1013) });
    expect(Buffer.byteLength(boundary, "utf8")).toBe(PII_PAYLOAD_MAX_BYTES);
    expect(() => formatAustralianPii({ employeeName: "a".repeat(1014) })).toThrow(RangeError);
  });

  it("publishes the finalized profile metadata", () => {
    expect(AUSTRALIAN_PII_TEXT_PROFILE_ID).toBe("io.verifiabl.au2-pii-text.v1");
    expect(NEW_ZEALAND_PII_TEXT_PROFILE_ID).toBe("io.verifiabl.nz2-pii-text.v1");
    expect(AUSTRALIAN_PII_FIELD_ORDER).toEqual([
      "employeeName",
      "position",
      "department",
      "employerIdentity",
      "bsb",
      "accountNumber",
      "accountName",
      "address",
    ]);
    expect(NEW_ZEALAND_PII_FIELD_ORDER).toEqual([
      "employeeName",
      "irdNumber",
      "position",
      "department",
      "employerName",
      "accountNumber",
      "accountName",
      "address",
    ]);
  });
});

type ProfileInput =
  | { profile: "AU2"; fields: AustralianPiiFields }
  | { profile: "NZ2"; fields: NewZealandPiiFields };

interface JurisdictionPiiVectors {
  valid: (ProfileInput & { id: string; plaintext: string; plaintextUtf8Hex: string })[];
  invalid: (ProfileInput & { id: string; expectedError: "invalid-text" | "payload-too-large" })[];
}

const jurisdictionVectors: JurisdictionPiiVectors = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "jurisdiction-pii-profile-vectors-v1.json",
    ),
    "utf8",
  ),
);

function formatProfile(input: ProfileInput): string {
  return input.profile === "AU2"
    ? formatAustralianPii(input.fields)
    : formatNewZealandPii(input.fields);
}

describe("AU2 and NZ2 conformance vectors", () => {
  it.each(jurisdictionVectors.valid)("formats $id byte for byte", (vector) => {
    const plaintext = formatProfile(vector);
    expect(plaintext).toBe(vector.plaintext);
    expect(Buffer.from(plaintext, "utf8").toString("hex")).toBe(vector.plaintextUtf8Hex);
  });

  it.each(jurisdictionVectors.invalid)("rejects $id", (vector) => {
    expect(() => formatProfile(vector)).toThrow(
      vector.expectedError === "payload-too-large" ? RangeError : ZodError,
    );
  });
});

describe("AU2 and NZ2 registration", () => {
  it("normalizes Node numbers and preserves exact string scale", () => {
    expect(payslipNumber(47.3684, "$47.3684/hr")).toEqual({
      value: "47.3684",
      display: "$47.3684/hr",
    });
    expect(payslipNumber("1.50")).toEqual({ value: "1.50" });
    expect(() => payslipNumber("1e3")).toThrow();
    expect(payslipNumber(1e-7)).toEqual({ value: "0.0000001" });
    expect(payslipNumber(-1.25e-7)).toEqual({ value: "-0.000000125" });
    expect(payslipNumber(1.2e21)).toEqual({ value: "1200000000000000000000" });
    expect(payslipNumber(Number("1e-324"))).toEqual({ value: "0" });
    expect(payslipNumber(Number.MIN_VALUE).value).toBe(`0.${"0".repeat(323)}5`);
  });

  it("maps AU2 without a period start", () => {
    expect(
      registrationToWire({
        schema: "au.payslip.v2",
        issuedAt: "2026-06-11T00:00:00Z",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          currency: "AUD",
          gross: { value: 8125, display: "$8,125.00" },
          paygw: { value: "2030.00" },
          net: { value: "6095.00" },
        },
        encryptionMetadata: metadata,
      }),
    ).toMatchObject({
      schema: "au.payslip.v2",
      payslip_non_pii: {
        period_end: "2026-05-31",
        payment_date: "2026-06-04",
        currency: "AUD",
        gross: { value: "8125", display: "$8,125.00" },
        paygw: { value: "2030.00" },
        net: { value: "6095.00" },
      },
    });
    expect(
      registrationToWire({
        schema: "au.payslip.v2",
        issuedAt: "2026-06-11T00:00:00Z",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          gross: { value: "0" },
          paygw: { value: "0" },
          net: { value: "0" },
        },
        encryptionMetadata: metadata,
      }),
    ).not.toHaveProperty("payslip_non_pii.period_start");
  });

  it("maps NZ2 descriptive and statutory fields", () => {
    expect(
      registrationToWire({
        schema: "nz.payslip.v2",
        issuedAt: "2026-06-11T00:00:00Z",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          gross: { value: "6000.00" },
          paye: { value: "1500.00" },
          net: { value: "4500.00" },
          taxCode: "M SL",
          studentLoan: { value: "-25.00" },
        },
        encryptionMetadata: metadata,
      }),
    ).toMatchObject({
      payslip_non_pii: {
        tax_code: "M SL",
        student_loan: { value: "-25.00" },
      },
    });
  });

  it("selects the non-PII contract by schema, not by PII marker", () => {
    const request = {
      schema: "au.payslip.v2" as const,
      issuedAt: "2026-06-11T00:00:00Z",
      payslipNonPii: {
        periodEnd: "2026-05-31",
        paymentDate: "2026-06-04",
        gross: { value: "1" },
        paygw: { value: "2" },
        net: { value: "3" },
      },
      encryptionMetadata: metadata,
    };
    expect(registrationToWire(request)).toMatchObject({ schema: "au.payslip.v2" });
    expect(
      registerNonPiiBatchToWire({
        records: [{ ...request, verifiablReference: "AbCdEfGhIjKlMnOpQrStUv" }],
      }),
    ).toMatchObject({ records: [{ schema: "au.payslip.v2" }] });
    expect(
      registerNonPiiRequestSchema.safeParse({ ...request, schema: "nz.payslip.v2" }).success,
    ).toBe(false);
  });

  it("publishes the ten supported optional currencies", () => {
    expect(supportedV2Currencies).toEqual([
      "AUD",
      "NZD",
      "USD",
      "GBP",
      "EUR",
      "CAD",
      "SGD",
      "HKD",
      "CHF",
      "ZAR",
    ]);
  });

  it("validates the ABN embedded in a numeric USI", () => {
    const payslip = {
      periodEnd: "2026-05-31",
      paymentDate: "2026-06-04",
      gross: { value: "1" },
      paygw: { value: "2" },
      net: { value: "3" },
      superannuation: [
        {
          contributionType: "superannuation_guarantee" as const,
          amount: { value: "0" },
          usi: "60905115063001",
        },
      ],
    };

    expect(australianPayslipV2Schema.safeParse(payslip).success).toBe(true);
    expect(
      australianPayslipV2Schema.safeParse({
        ...payslip,
        superannuation: [{ ...payslip.superannuation[0], usi: "12345678901001" }],
      }).success,
    ).toBe(false);
  });

  it("maps both v2 schemas in batch requests", () => {
    const records = [
      {
        schema: "au.payslip.v2" as const,
        issuedAt: "2026-06-11T00:00:00Z",
        verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          gross: { value: "1" },
          paygw: { value: "2" },
          net: { value: "3" },
        },
        encryptionMetadata: metadata,
      },
      {
        schema: "nz.payslip.v2" as const,
        issuedAt: "2026-06-11T00:00:00Z",
        verifiablReference: "ZbCdEfGhIjKlMnOpQrStUv",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          gross: { value: "1" },
          paye: { value: "2" },
          net: { value: "3" },
        },
        encryptionMetadata: metadata,
      },
    ];

    expect(registerNonPiiBatchToWire({ records })).toMatchObject({
      records: [
        { schema: "au.payslip.v2", payslip_non_pii: { gross: { value: "1" } } },
        { schema: "nz.payslip.v2", payslip_non_pii: { paye: { value: "2" } } },
      ],
    });
  });
});
