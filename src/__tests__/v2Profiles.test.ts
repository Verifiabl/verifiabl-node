import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  australianPayslipV2Schema,
  newZealandPayslipV2Schema,
  supportedV2Currencies,
} from "../payslipV2.js";
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
  PiiValidationError,
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
      vector.expectedError === "payload-too-large" ? RangeError : PiiValidationError,
    );
  });
});

describe("AU2 and NZ2 registration", () => {
  const minimalAu = {
    periodEnd: "2026-05-31",
    paymentDate: "2026-06-04",
    currency: "AUD",
    gross: "1",
    paygw: "2",
    net: "3",
  } as const;

  it("sends decimal strings exactly as given", () => {
    for (const value of [
      "1234",
      "1234.56",
      "47.3684",
      "-123.45",
      "0.00",
      "1.50",
      "1.5",
      "0.10000000000000000001",
    ]) {
      expect(australianPayslipV2Schema.parse({ ...minimalAu, gross: value }).gross).toBe(value);
    }
  });

  it("rejects numbers outside the decimal grammar without echoing the value", () => {
    for (const value of [
      "",
      "1e3",
      "+1",
      "1,234.56",
      "$1234.56",
      "(123.45)",
      "1.",
      ".5",
      " 1",
      "1\n",
      "١٢",
    ]) {
      const result = australianPayslipV2Schema.safeParse({ ...minimalAu, gross: value });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["gross"]);
    }
    const leaked = australianPayslipV2Schema.safeParse({ ...minimalAu, gross: "SECRET-8125" });
    expect(JSON.stringify(leaked.error?.issues)).not.toContain("SECRET");
    for (const value of [1234.56, { value: "1234.56" }, null]) {
      expect(australianPayslipV2Schema.safeParse({ ...minimalAu, gross: value }).success).toBe(
        false,
      );
    }
  });

  it("requires a supported ISO 4217 currency", () => {
    const { currency: _, ...withoutCurrency } = minimalAu;
    expect(australianPayslipV2Schema.safeParse(withoutCurrency).success).toBe(false);
    expect(
      newZealandPayslipV2Schema.safeParse({
        periodEnd: "2026-05-31",
        paymentDate: "2026-06-04",
        gross: "1",
        paye: "2",
        net: "3",
      }).success,
    ).toBe(false);
    for (const currency of ["JPY", "BHD", "XAF", "XOF", "XCD", "XPF", "ZWG"]) {
      expect(australianPayslipV2Schema.safeParse({ ...minimalAu, currency }).success).toBe(true);
    }
    for (const currency of ["aud", "AU", "ZWL", "XYZ", "XTS", "XXX", "XAU", "CLF"]) {
      expect(australianPayslipV2Schema.safeParse({ ...minimalAu, currency }).success).toBe(false);
    }
  });

  it("accepts an 'other' earnings line for a pay code that fits no type", () => {
    const other = { type: "other", amount: "200.00", ytdAmount: "600.00" } as const;
    expect(australianPayslipV2Schema.safeParse({ ...minimalAu, earnings: [other] }).success).toBe(
      true,
    );
    expect(
      newZealandPayslipV2Schema.safeParse({
        periodEnd: "2026-05-31",
        paymentDate: "2026-06-04",
        currency: "NZD",
        gross: "1",
        paye: "2",
        net: "3",
        earnings: [other],
      }).success,
    ).toBe(true);
  });

  it("accepts four-weekly and semi-monthly AU2 pay frequencies", () => {
    for (const payFrequency of ["four_weekly", "semi_monthly"] as const) {
      expect(australianPayslipV2Schema.safeParse({ ...minimalAu, payFrequency }).success).toBe(
        true,
      );
    }
    expect(
      australianPayslipV2Schema.safeParse({ ...minimalAu, payFrequency: "half_monthly" }).success,
    ).toBe(false);
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
          gross: "8125",
          paygw: "2030.00",
          net: "6095.00",
          hourly: { ordinaryRate: "47.3684", hours: "-76.00", amount: "3600.00" },
        },
        encryptionMetadata: metadata,
      }),
    ).toMatchObject({
      schema: "au.payslip.v2",
      payslip_non_pii: {
        period_end: "2026-05-31",
        payment_date: "2026-06-04",
        currency: "AUD",
        gross: "8125",
        paygw: "2030.00",
        net: "6095.00",
        hourly: { ordinary_rate: "47.3684", hours: "-76.00", amount: "3600.00" },
      },
    });
    expect(
      registrationToWire({
        schema: "au.payslip.v2",
        issuedAt: "2026-06-11T00:00:00Z",
        payslipNonPii: { ...minimalAu, gross: "0", paygw: "0", net: "0" },
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
          currency: "NZD",
          gross: "6000.00",
          paye: "1500.00",
          net: "4500.00",
          taxCode: "M SL",
          studentLoan: "-25.00",
          leaveBalances: { annual: { amount: "76.5", unit: "hours" } },
        },
        encryptionMetadata: metadata,
      }),
    ).toMatchObject({
      payslip_non_pii: {
        currency: "NZD",
        tax_code: "M SL",
        student_loan: "-25.00",
        leave_balances: { annual: { amount: "76.5", unit: "hours" } },
      },
    });
  });

  it("selects the non-PII contract by schema, not by PII marker", () => {
    const request = {
      schema: "au.payslip.v2" as const,
      issuedAt: "2026-06-11T00:00:00Z",
      payslipNonPii: minimalAu,
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

  it("publishes the payable ISO 4217 currency list", () => {
    expect(supportedV2Currencies).toHaveLength(155);
    expect(new Set(supportedV2Currencies).size).toBe(155);
    expect(supportedV2Currencies).toEqual([...supportedV2Currencies].sort());
    expect(supportedV2Currencies).toEqual(expect.arrayContaining(["AUD", "NZD", "JPY"]));
  });

  it("validates the ABN embedded in a numeric USI", () => {
    const payslip = {
      ...minimalAu,
      superannuation: [
        {
          contributionType: "superannuation_guarantee" as const,
          amount: "0",
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
        payslipNonPii: minimalAu,
        encryptionMetadata: metadata,
      },
      {
        schema: "nz.payslip.v2" as const,
        issuedAt: "2026-06-11T00:00:00Z",
        verifiablReference: "ZbCdEfGhIjKlMnOpQrStUv",
        payslipNonPii: {
          periodEnd: "2026-05-31",
          paymentDate: "2026-06-04",
          currency: "NZD" as const,
          gross: "1",
          paye: "2",
          net: "3",
        },
        encryptionMetadata: metadata,
      },
    ];

    expect(registerNonPiiBatchToWire({ records })).toMatchObject({
      records: [
        { schema: "au.payslip.v2", payslip_non_pii: { gross: "1" } },
        { schema: "nz.payslip.v2", payslip_non_pii: { paye: "2" } },
      ],
    });
  });
});
