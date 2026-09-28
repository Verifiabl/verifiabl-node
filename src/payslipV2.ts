import { z } from "zod";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

export const AUSTRALIAN_PAYSLIP_V2_SCHEMA = "au.payslip.v2";
export const NEW_ZEALAND_PAYSLIP_V2_SCHEMA = "nz.payslip.v2";

export const supportedV2Currencies = tuple([
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

const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "value must be a decimal number, for example 1234.56");

const decimalValueSchema = z.union([
  decimalStringSchema,
  z
    .number()
    .finite()
    .transform((value) => value.toString())
    .pipe(decimalStringSchema),
]);

const payslipNumberObject = z
  .object({
    value: decimalValueSchema,
    display: z.string().min(1).optional(),
  })
  .strict();

// Interfaces, not z.input/z.output aliases: TypeDoc expands an inferred alias at every use site.
/** A v2 amount, rate, or quantity with an optional printed representation. */
export interface PayslipNumber extends z.input<typeof payslipNumberObject> {}
export interface NormalizedPayslipNumber extends z.output<typeof payslipNumberObject> {}

/** A v2 amount, rate, or quantity with an optional printed representation. */
export const payslipNumberSchema: z.ZodType<NormalizedPayslipNumber, PayslipNumber> =
  payslipNumberObject;

/** Build and validate a v2 number while preserving an exact string when supplied. */
export function payslipNumber(value: string | number, display?: string): NormalizedPayslipNumber {
  return payslipNumberSchema.parse({ value, ...(display === undefined ? {} : { display }) });
}

// The v2 wire contract preserves printed strings in non-PII fields. Integrators must
// keep employee PII out of these values; syntax validation cannot establish that.
const printedText = z.string().min(1);
const currency = z.enum(supportedV2Currencies).optional();

export const australianPaidLeaveTypes = tuple([
  "cash_out_in_service",
  "unused_on_termination",
  "paid_parental",
  "workers_compensation",
  "ancillary_defence",
  "other_paid_leave",
]);
export const australianAllowanceTypes = tuple([
  "cents_per_km",
  "award_transport",
  "laundry",
  "overtime_meal",
  "travel",
  "tools",
  "tasks",
  "qualifications",
  "other",
]);
export const australianOtherAllowanceCategories = tuple([
  "home_office",
  "non_deductible",
  "transport_fares",
  "uniform",
  "private_vehicle",
  "general",
]);
export const australianDeductionTypes = tuple([
  "union_professional_fees",
  "workplace_giving",
  "child_support_deduction",
  "child_support_garnishee",
  "other_post_tax",
]);
export const australianSalarySacrificeTypes = tuple(["super", "other"]);
export const australianSuperContributionTypes = tuple([
  "superannuation_guarantee",
  "resc",
  "salary_sacrifice",
]);
export const australianPayFrequencies = tuple(["weekly", "fortnightly", "monthly", "quarterly"]);
export const australianEmploymentBases = tuple([
  "full_time",
  "part_time",
  "casual",
  "labour_hire",
  "voluntary_agreement",
  "death_beneficiary",
  "non_employee",
]);
export const australianEngagementTypes = tuple(["permanent", "fixed_term"]);
const australianPlainEarningsTypes = tuple([
  "ordinary",
  "overtime",
  "bonus_commission",
  "directors_fees",
  "lump_sum",
  "return_to_work",
]);

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function isChecksumValidAbn(value: string): boolean {
  const weighted = [...value].reduce(
    (sum, character, index) =>
      sum + (Number(character) - (index === 0 ? 1 : 0)) * (ABN_WEIGHTS[index] ?? 0),
    0,
  );
  return weighted % 89 === 0;
}

const usiSchema = z
  .string()
  .regex(
    /^(\d{14}|[A-Z]{3}\d{4}[A-Z]{2})$/,
    "usi must be a fund ABN plus 3-digit product suffix or a SPIN",
  )
  .refine(
    (value) => !/^\d{14}$/.test(value) || isChecksumValidAbn(value.slice(0, 11)),
    "usi's leading 11 digits must be a checksum-valid ABN",
  );

const australianEarningsFields = {
  amount: payslipNumberSchema,
  units: payslipNumberSchema.optional(),
  rate: payslipNumberSchema.optional(),
  ytdAmount: payslipNumberSchema.optional(),
};

const australianEarningsLineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("paid_leave"),
      leaveType: z.enum(australianPaidLeaveTypes),
      ...australianEarningsFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("allowance"),
      allowanceType: z.enum(australianAllowanceTypes),
      otherCategory: z.enum(australianOtherAllowanceCategories).optional(),
      ...australianEarningsFields,
    })
    .strict(),
  ...australianPlainEarningsTypes.map((type) =>
    z.object({ type: z.literal(type), ...australianEarningsFields }).strict(),
  ),
]);

const australianPayslipV2Fields = z
  .object({
    periodStart: z.iso.date().optional(),
    periodEnd: z.iso.date(),
    paymentDate: z.iso.date(),
    currency,
    gross: payslipNumberSchema,
    paygw: payslipNumberSchema,
    net: payslipNumberSchema,
    ytdGross: payslipNumberSchema.optional(),
    ytdPaygw: payslipNumberSchema.optional(),
    payFrequency: z.enum(australianPayFrequencies).optional(),
    employmentBasis: z.enum(australianEmploymentBases).optional(),
    engagementType: z.enum(australianEngagementTypes).optional(),
    award: printedText.optional(),
    hourly: z
      .object({
        ordinaryRate: payslipNumberSchema,
        hours: payslipNumberSchema,
        amount: payslipNumberSchema,
      })
      .strict()
      .optional(),
    annualRate: payslipNumberSchema.optional(),
    taxableGross: payslipNumberSchema.optional(),
    stslWithholding: payslipNumberSchema.optional(),
    earnings: z.array(australianEarningsLineSchema).optional(),
    salarySacrifice: z
      .array(
        z
          .object({
            type: z.enum(australianSalarySacrificeTypes),
            amount: payslipNumberSchema,
            ytdAmount: payslipNumberSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    deductions: z
      .array(
        z
          .object({
            type: z.enum(australianDeductionTypes),
            amount: payslipNumberSchema,
            ytdAmount: payslipNumberSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    superannuation: z
      .array(
        z
          .object({
            contributionType: z.enum(australianSuperContributionTypes),
            amount: payslipNumberSchema,
            rate: payslipNumberSchema.optional(),
            ytdAmount: payslipNumberSchema.optional(),
            usi: usiSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    reimbursements: payslipNumberSchema.optional(),
    ytd: z
      .object({
        taxable: payslipNumberSchema.optional(),
        super: payslipNumberSchema.optional(),
        nonTaxable: payslipNumberSchema.optional(),
        postTaxDeductions: payslipNumberSchema.optional(),
        reimbursements: payslipNumberSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface AustralianPayslipV2 extends z.input<typeof australianPayslipV2Fields> {}
export interface NormalizedAustralianPayslipV2 extends z.output<typeof australianPayslipV2Fields> {}

export const australianPayslipV2Schema: z.ZodType<
  NormalizedAustralianPayslipV2,
  AustralianPayslipV2
> = australianPayslipV2Fields.superRefine((value, ctx) => {
  if (value.periodStart !== undefined && value.periodEnd < value.periodStart) {
    ctx.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "periodEnd must not be before periodStart",
    });
  }
  for (const [index, line] of (value.earnings ?? []).entries()) {
    if (line.type !== "allowance") continue;
    if (line.allowanceType === "other" && line.otherCategory === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["earnings", index, "otherCategory"],
        message: "otherCategory is required on an 'other' allowance",
      });
    } else if (line.allowanceType !== "other" && line.otherCategory !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["earnings", index, "otherCategory"],
        message: "otherCategory applies only to allowanceType 'other'",
      });
    }
  }
});

export const newZealandPaidLeaveTypes = tuple([
  "annual_holiday",
  "public_holiday",
  "alternative_holiday",
  "sick_leave",
  "bereavement_leave",
  "other_paid_leave",
]);
export const newZealandAllowanceTypes = tuple([
  "meal",
  "travel",
  "accommodation",
  "vehicle",
  "phone",
  "tools",
  "uniform",
  "on_call",
  "shift",
  "first_aid",
  "higher_duties",
  "qualification",
  "other",
]);
export const newZealandDeductionTypes = tuple([
  "union_fees",
  "payroll_donation",
  "attachment_order",
  "ir_arrears",
  "other_post_tax",
]);
export const newZealandLeaveBalanceUnits = tuple(["hours", "days", "weeks"]);
const newZealandPlainEarningsTypes = tuple([
  "ordinary",
  "overtime",
  "penal_rate",
  "piece_work",
  "bonus_commission",
  "extra_pay",
  "schedular_payment",
  "directors_fees",
  "pay_as_you_go_holiday_pay",
  "leave_compensation_payment",
  "annual_holiday_cash_out",
  "alternative_holiday_cash_out",
  "holiday_pay_on_termination",
]);

const newZealandEarningsFields = {
  amount: payslipNumberSchema,
  units: payslipNumberSchema.optional(),
  rate: payslipNumberSchema.optional(),
  ytdAmount: payslipNumberSchema.optional(),
};

const newZealandEarningsLineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("paid_leave"),
      leaveType: z.enum(newZealandPaidLeaveTypes),
      ...newZealandEarningsFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("allowance"),
      allowanceType: z.enum(newZealandAllowanceTypes),
      ...newZealandEarningsFields,
    })
    .strict(),
  ...newZealandPlainEarningsTypes.map((type) =>
    z.object({ type: z.literal(type), ...newZealandEarningsFields }).strict(),
  ),
]);

const leaveBalanceSchema = z
  .object({ amount: payslipNumberSchema, unit: z.enum(newZealandLeaveBalanceUnits) })
  .strict();

const newZealandPayslipV2Fields = z
  .object({
    periodStart: z.iso.date().optional(),
    periodEnd: z.iso.date(),
    paymentDate: z.iso.date(),
    currency,
    gross: payslipNumberSchema,
    paye: payslipNumberSchema,
    net: payslipNumberSchema,
    ytdGross: payslipNumberSchema.optional(),
    ytdPaye: payslipNumberSchema.optional(),
    payCycle: printedText.optional(),
    taxCode: printedText.optional(),
    employmentType: printedText.optional(),
    hoursPaid: payslipNumberSchema.optional(),
    hourly: z
      .object({
        ordinaryRate: payslipNumberSchema,
        hours: payslipNumberSchema,
        amount: payslipNumberSchema,
      })
      .strict()
      .optional(),
    annualRate: payslipNumberSchema.optional(),
    earningsNotLiableForAcc: payslipNumberSchema.optional(),
    earnings: z.array(newZealandEarningsLineSchema).optional(),
    employeeShareScheme: payslipNumberSchema.optional(),
    priorPeriodGrossAdjustment: payslipNumberSchema.optional(),
    priorPeriodPayeAdjustment: payslipNumberSchema.optional(),
    payrollDonationTaxCredit: payslipNumberSchema.optional(),
    studentLoan: payslipNumberSchema.optional(),
    slcir: payslipNumberSchema.optional(),
    slbor: payslipNumberSchema.optional(),
    childSupport: payslipNumberSchema.optional(),
    kiwisaverEmployeeDeduction: payslipNumberSchema.optional(),
    kiwisaverEmployeeRate: payslipNumberSchema.optional(),
    kiwisaverEmployerContribution: payslipNumberSchema.optional(),
    esct: payslipNumberSchema.optional(),
    deductions: z
      .array(
        z
          .object({
            type: z.enum(newZealandDeductionTypes),
            amount: payslipNumberSchema,
            ytdAmount: payslipNumberSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    reimbursements: payslipNumberSchema.optional(),
    leaveBalances: z
      .object({
        annual: leaveBalanceSchema.optional(),
        annualAccruedThisPeriod: leaveBalanceSchema.optional(),
        sick: leaveBalanceSchema.optional(),
        sickAccruedThisPeriod: leaveBalanceSchema.optional(),
        alternative: leaveBalanceSchema.optional(),
      })
      .strict()
      .optional(),
    ytd: z
      .object({
        studentLoan: payslipNumberSchema.optional(),
        kiwisaverEmployee: payslipNumberSchema.optional(),
        kiwisaverEmployer: payslipNumberSchema.optional(),
        childSupport: payslipNumberSchema.optional(),
        nonTaxable: payslipNumberSchema.optional(),
        postTaxDeductions: payslipNumberSchema.optional(),
        reimbursements: payslipNumberSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface NewZealandPayslipV2 extends z.input<typeof newZealandPayslipV2Fields> {}
export interface NormalizedNewZealandPayslipV2 extends z.output<typeof newZealandPayslipV2Fields> {}

export const newZealandPayslipV2Schema: z.ZodType<
  NormalizedNewZealandPayslipV2,
  NewZealandPayslipV2
> = newZealandPayslipV2Fields.superRefine((value, ctx) => {
  if (value.periodStart !== undefined && value.periodEnd < value.periodStart) {
    ctx.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "periodEnd must not be before periodStart",
    });
  }
});

function when<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function numberToWire(value: NormalizedPayslipNumber): Record<string, string> {
  return { value: value.value, ...when(value.display, "display") };
}

function numbersToWire<T extends Record<string, NormalizedPayslipNumber | undefined>>(
  values: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .filter((entry): entry is [string, NormalizedPayslipNumber] => entry[1] !== undefined)
      .map(([key, value]) => [key, numberToWire(value)]),
  );
}

export function australianPayslipV2ToWire(
  data: NormalizedAustralianPayslipV2,
): Record<string, unknown> {
  return {
    ...when(data.periodStart, "period_start"),
    period_end: data.periodEnd,
    payment_date: data.paymentDate,
    ...when(data.currency, "currency"),
    ...numbersToWire({
      gross: data.gross,
      paygw: data.paygw,
      net: data.net,
      ytd_gross: data.ytdGross,
      ytd_paygw: data.ytdPaygw,
      annual_rate: data.annualRate,
      taxable_gross: data.taxableGross,
      stsl_withholding: data.stslWithholding,
      reimbursements: data.reimbursements,
    }),
    ...when(data.payFrequency, "pay_frequency"),
    ...when(data.employmentBasis, "employment_basis"),
    ...when(data.engagementType, "engagement_type"),
    ...when(data.award, "award"),
    ...(data.hourly === undefined
      ? {}
      : {
          hourly: {
            ordinary_rate: numberToWire(data.hourly.ordinaryRate),
            hours: numberToWire(data.hourly.hours),
            amount: numberToWire(data.hourly.amount),
          },
        }),
    ...(data.earnings === undefined
      ? {}
      : {
          earnings: data.earnings.map((line) => ({
            type: line.type,
            ...(line.type === "paid_leave" ? { leave_type: line.leaveType } : {}),
            ...(line.type === "allowance"
              ? {
                  allowance_type: line.allowanceType,
                  ...when(line.otherCategory, "other_category"),
                }
              : {}),
            amount: numberToWire(line.amount),
            ...numbersToWire({ units: line.units, rate: line.rate, ytd_amount: line.ytdAmount }),
          })),
        }),
    ...(data.salarySacrifice === undefined
      ? {}
      : {
          salary_sacrifice: data.salarySacrifice.map((line) => ({
            type: line.type,
            amount: numberToWire(line.amount),
            ...numbersToWire({ ytd_amount: line.ytdAmount }),
          })),
        }),
    ...(data.deductions === undefined
      ? {}
      : {
          deductions: data.deductions.map((line) => ({
            type: line.type,
            amount: numberToWire(line.amount),
            ...numbersToWire({ ytd_amount: line.ytdAmount }),
          })),
        }),
    ...(data.superannuation === undefined
      ? {}
      : {
          superannuation: data.superannuation.map((line) => ({
            contribution_type: line.contributionType,
            amount: numberToWire(line.amount),
            ...numbersToWire({ rate: line.rate, ytd_amount: line.ytdAmount }),
            ...when(line.usi, "usi"),
          })),
        }),
    ...(data.ytd === undefined
      ? {}
      : {
          ytd: numbersToWire({
            taxable: data.ytd.taxable,
            super: data.ytd.super,
            non_taxable: data.ytd.nonTaxable,
            post_tax_deductions: data.ytd.postTaxDeductions,
            reimbursements: data.ytd.reimbursements,
          }),
        }),
  };
}

export function newZealandPayslipV2ToWire(
  data: NormalizedNewZealandPayslipV2,
): Record<string, unknown> {
  const balance = (value: { amount: NormalizedPayslipNumber; unit: string }) => ({
    amount: numberToWire(value.amount),
    unit: value.unit,
  });
  return {
    ...when(data.periodStart, "period_start"),
    period_end: data.periodEnd,
    payment_date: data.paymentDate,
    ...when(data.currency, "currency"),
    ...numbersToWire({
      gross: data.gross,
      paye: data.paye,
      net: data.net,
      ytd_gross: data.ytdGross,
      ytd_paye: data.ytdPaye,
      hours_paid: data.hoursPaid,
      annual_rate: data.annualRate,
      earnings_not_liable_for_acc: data.earningsNotLiableForAcc,
      employee_share_scheme: data.employeeShareScheme,
      prior_period_gross_adjustment: data.priorPeriodGrossAdjustment,
      prior_period_paye_adjustment: data.priorPeriodPayeAdjustment,
      payroll_donation_tax_credit: data.payrollDonationTaxCredit,
      student_loan: data.studentLoan,
      slcir: data.slcir,
      slbor: data.slbor,
      child_support: data.childSupport,
      kiwisaver_employee_deduction: data.kiwisaverEmployeeDeduction,
      kiwisaver_employee_rate: data.kiwisaverEmployeeRate,
      kiwisaver_employer_contribution: data.kiwisaverEmployerContribution,
      esct: data.esct,
      reimbursements: data.reimbursements,
    }),
    ...when(data.payCycle, "pay_cycle"),
    ...when(data.taxCode, "tax_code"),
    ...when(data.employmentType, "employment_type"),
    ...(data.hourly === undefined
      ? {}
      : {
          hourly: {
            ordinary_rate: numberToWire(data.hourly.ordinaryRate),
            hours: numberToWire(data.hourly.hours),
            amount: numberToWire(data.hourly.amount),
          },
        }),
    ...(data.earnings === undefined
      ? {}
      : {
          earnings: data.earnings.map((line) => ({
            type: line.type,
            ...(line.type === "paid_leave" ? { leave_type: line.leaveType } : {}),
            ...(line.type === "allowance" ? { allowance_type: line.allowanceType } : {}),
            amount: numberToWire(line.amount),
            ...numbersToWire({ units: line.units, rate: line.rate, ytd_amount: line.ytdAmount }),
          })),
        }),
    ...(data.deductions === undefined
      ? {}
      : {
          deductions: data.deductions.map((line) => ({
            type: line.type,
            amount: numberToWire(line.amount),
            ...numbersToWire({ ytd_amount: line.ytdAmount }),
          })),
        }),
    ...(data.leaveBalances === undefined
      ? {}
      : {
          leave_balances: {
            ...when(data.leaveBalances.annual && balance(data.leaveBalances.annual), "annual"),
            ...when(
              data.leaveBalances.annualAccruedThisPeriod &&
                balance(data.leaveBalances.annualAccruedThisPeriod),
              "annual_accrued_this_period",
            ),
            ...when(data.leaveBalances.sick && balance(data.leaveBalances.sick), "sick"),
            ...when(
              data.leaveBalances.sickAccruedThisPeriod &&
                balance(data.leaveBalances.sickAccruedThisPeriod),
              "sick_accrued_this_period",
            ),
            ...when(
              data.leaveBalances.alternative && balance(data.leaveBalances.alternative),
              "alternative",
            ),
          },
        }),
    ...(data.ytd === undefined
      ? {}
      : {
          ytd: numbersToWire({
            student_loan: data.ytd.studentLoan,
            kiwisaver_employee: data.ytd.kiwisaverEmployee,
            kiwisaver_employer: data.ytd.kiwisaverEmployer,
            child_support: data.ytd.childSupport,
            non_taxable: data.ytd.nonTaxable,
            post_tax_deductions: data.ytd.postTaxDeductions,
            reimbursements: data.ytd.reimbursements,
          }),
        }),
  };
}
