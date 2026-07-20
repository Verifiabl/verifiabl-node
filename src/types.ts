import { z } from "zod";
import { verifiablReferenceSchema } from "./payload.js";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Key version contract: `<provider-id>.<n>` where provider-id is your
 * lowercase provider ID and n increments on each key rotation, starting at
 * 1. Verifiabl looks up the matching encryption key by this value at
 * verification time. Note this provider ID is distinct from your OAuth
 * `clientId`.
 */
export const KEY_VERSION_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[1-9][0-9]{0,5}$/;

export const SCHEMA_RE = /^[a-z]{2}\.[a-z]+\.v\d+$/;

export const keyVersionSchema = z.string().regex(KEY_VERSION_RE, {
  error: "keyVersion must be '<provider-id>.<n>' (lowercase provider ID, rotation counter from 1)",
});

export const payslipSchemaIdSchema = z.string().regex(SCHEMA_RE, {
  error: "schema must be in format 'xx.type.vN' (e.g. 'au.payslip.v1')",
});

/**
 * Request and response types for the Verifiabl API.
 *
 * The SDK surface is camelCase throughout. The HTTP API speaks snake_case
 * (`issued_at`, `payslip_non_pii`, `verifiabl_reference`, ...); the SDK translates
 * to and from that wire format at the network boundary (see the `*ToWire`
 * and `*FromWire` helpers below), so you never handle snake_case yourself.
 *
 * Request schemas are strict: they reject unknown fields so integration
 * mistakes fail fast and locally. Response schemas are deliberately
 * tolerant: they validate the fields this SDK version knows about and
 * ignore any the API adds later, so an additive API change never breaks
 * a deployed integration.
 */

/** Decryption metadata stored server-side at registration time. */
export const encryptionMetadataSchema = z
  .object({
    /** 96-bit IV, exactly 16 base64url characters. */
    iv: z.string().length(16).regex(BASE64URL_RE),
    /** 128-bit GCM auth tag, exactly 22 base64url characters. */
    tag: z.string().length(22).regex(BASE64URL_RE),
    /** Provider key version identifier in deployed `<provider-id>.<n>` format. */
    keyVersion: keyVersionSchema,
  })
  .strict();

export type EncryptionMetadata = z.infer<typeof encryptionMetadataSchema>;

/** Signed integer minor units. Money is never a float: a float cannot represent it exactly. */
const cents = z.int();

/** A quantity that is not money (hours, days). */
const quantity = z.number().nonnegative().finite();

/**
 * ABR checksum (abr.business.gov.au/Help/AbnFormat): subtract 1 from the first
 * digit, weight each digit, and the sum must divide by 89. Catches a typo'd or
 * fabricated identifier here rather than at the API.
 */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function isChecksumValidAbn(value: string): boolean {
  const weighted = [...value].reduce(
    (sum, character, index) =>
      sum + (Number(character) - (index === 0 ? 1 : 0)) * (ABN_WEIGHTS[index] ?? 0),
    0,
  );
  return weighted % 89 === 0;
}

const abnSchema = z
  .string()
  .regex(/^\d{11}$/, "ABN must be 11 digits")
  .refine(isChecksumValidAbn, "ABN checksum is invalid");

/**
 * Unique Superannuation Identifier, APRA products only: a fund ABN plus a
 * 3-digit product suffix, or a SPIN (e.g. STA0100AU). A bare 11-digit ABN is
 * not accepted: that is the SMSF form, and an SMSF ABN resolves publicly to a
 * fund name that often carries the member's name. Register SMSF contributions
 * without a fund identifier.
 */
const usiSchema = z
  .string()
  .regex(
    /^(\d{14}|[A-Z]{3}\d{4}[A-Z]{2})$/,
    "USI must be a fund ABN plus 3-digit product suffix (14 digits) or a SPIN (e.g. STA0100AU)",
  )
  .refine(
    (value) => !/^\d{14}$/.test(value) || isChecksumValidAbn(value.slice(0, 11)),
    "USI's leading 11 digits must be a checksum-valid ABN",
  );

/**
 * ATO STP Phase 2 paid-leave codes. There is deliberately no family-and-domestic
 * violence category: Fair Work reg 3.48 forbids identifying FDV leave on a pay
 * slip, so it is reported as ordinary hours, another payment type or (only at
 * the employee's request) another kind of leave.
 */
export const paidLeaveTypes = tuple([
  "cash_out_in_service",
  "unused_on_termination",
  "paid_parental",
  "workers_compensation",
  "ancillary_defence",
  "other_paid_leave",
]);

/** ATO STP Phase 2 allowance codes (CD/AD/LD/MD/RD/TD/KN/QN/OD). */
export const allowanceTypes = tuple([
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

/** The ATO's descriptor categories for an `other` (OD) allowance. */
export const otherAllowanceCategories = tuple([
  "home_office",
  "non_deductible",
  "transport_fares",
  "uniform",
  "private_vehicle",
  "general",
]);

/** Post-tax deductions. PAYG withholding is NOT one: it is `paygwCents`. */
export const deductionTypes = tuple([
  "union_professional_fees",
  "workplace_giving",
  "child_support_deduction",
  "child_support_garnishee",
  "other_post_tax",
]);

export const salarySacrificeTypes = tuple(["super", "other"]);

/** Employer-side only: an after-tax member contribution is a deduction. */
export const superContributionTypes = tuple([
  "superannuation_guarantee",
  "resc",
  "salary_sacrifice",
]);

export const payFrequencies = tuple(["weekly", "fortnightly", "monthly", "quarterly"]);

/** STP2 employment-basis codes. Independent of `engagementType`. */
export const employmentBases = tuple([
  "full_time",
  "part_time",
  "casual",
  "labour_hire",
  "voluntary_agreement",
  "death_beneficiary",
  "non_employee",
]);

export const engagementTypes = tuple(["permanent", "fixed_term"]);

/** Earnings categories carrying no sub-code. */
const plainEarningsTypes = tuple([
  "ordinary",
  "overtime",
  "bonus_commission",
  "directors_fees",
  "lump_sum",
  "return_to_work",
]);

/**
 * One earnings line. A leave line must carry a leave code and an allowance line
 * an allowance code; neither can carry the other's. Earnings itemise
 * `grossCents`; they are not additional to it.
 */
const earningsLineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("paid_leave"),
      leaveType: z.enum(paidLeaveTypes),
      amountCents: cents,
      units: quantity.optional(),
      rateCents: cents.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("allowance"),
      allowanceType: z.enum(allowanceTypes),
      /** Required on an `other` allowance, forbidden on any other. */
      otherCategory: z.enum(otherAllowanceCategories).optional(),
      amountCents: cents,
      units: quantity.optional(),
      rateCents: cents.optional(),
    })
    .strict(),
  ...plainEarningsTypes.map((type) =>
    z
      .object({
        type: z.literal(type),
        amountCents: cents,
        units: quantity.optional(),
        rateCents: cents.optional(),
      })
      .strict(),
  ),
]);

export type EarningsLine = z.infer<typeof earningsLineSchema>;

const payslipNonPiiFields = z
  .object({
    // ---- Core: required on every payslip. ----
    // z.iso.date, not a YYYY-MM-DD regex: it is what the API validates with, and
    // it rejects a date that cannot exist (2026-02-31, 2027-02-29) rather than
    // letting it through to fail at registration.
    periodStart: z.iso.date({ error: "periodStart must be a real date in YYYY-MM-DD format" }),
    periodEnd: z.iso.date({ error: "periodEnd must be a real date in YYYY-MM-DD format" }),
    /** Legally mandatory on a pay slip (Fair Work reg 3.46(1)(d)). */
    paymentDate: z.iso.date({ error: "paymentDate must be a real date in YYYY-MM-DD format" }),
    currency: z.literal("AUD"),
    /** Total gross, before salary sacrifice (per STP2). */
    grossCents: cents,
    /** PAYG withholding: its own component, never also a `deductions` line. */
    paygwCents: cents,
    netCents: cents,
    /** Year to date over the AU financial year, as at and including this payslip. */
    ytdGrossCents: cents,
    ytdPaygwCents: cents,

    // ---- Optional. ----
    payFrequency: z.enum(payFrequencies).optional(),
    employmentBasis: z.enum(employmentBases).optional(),
    engagementType: z.enum(engagementTypes).optional(),
    hourly: z
      .object({ ordinaryRateCents: cents, hours: quantity, amountCents: cents })
      .strict()
      .optional(),
    annualRateCents: cents.optional(),
    /** The printed post-sacrifice/taxable gross, where the payslip shows one. */
    taxableGrossCents: cents.optional(),
    /** The printed HELP/STSL component: a non-additive part of `paygwCents`. */
    stslWithholdingCents: cents.optional(),
    /** Itemisation of gross. If present, must sum to `grossCents` exactly. */
    earnings: z.array(earningsLineSchema).optional(),
    salarySacrifice: z
      .array(z.object({ type: z.enum(salarySacrificeTypes), amountCents: cents }).strict())
      .optional(),
    /** Post-tax only. */
    deductions: z
      .array(z.object({ type: z.enum(deductionTypes), amountCents: cents }).strict())
      .optional(),
    /** Funds are identified structurally (USI/ABN) or not at all, never by name. */
    superannuation: z
      .array(
        z
          .object({
            contributionType: z.enum(superContributionTypes),
            amountCents: cents,
            usi: usiSchema.optional(),
            fundAbn: abnSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    /** Non-taxable: not part of gross, but paid out in net. */
    reimbursementsCents: cents.optional(),
    ytd: z
      .object({
        taxableCents: cents.optional(),
        superCents: cents.optional(),
        nonTaxableCents: cents.optional(),
        postTaxDeductionsCents: cents.optional(),
        reimbursementsCents: cents.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const sumAmounts = (lines: readonly { amountCents: number }[] | undefined): number =>
  (lines ?? []).reduce((total, line) => total + line.amountCents, 0);

/**
 * Non-PII payslip data: the canonical `au.payslip.v1` schema.
 *
 * Closed and free-text-free by design, so no field can carry a person's name.
 * Every rule the API enforces is enforced here too, so an integration mistake
 * fails locally with a clear message instead of as a 400 from the API.
 */
export const payslipNonPiiSchema = payslipNonPiiFields.superRefine((value, ctx) => {
  if (value.periodEnd < value.periodStart) {
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

  // The accounting identity the API enforces, in exact integer arithmetic. Gross
  // is pre-sacrifice and PAYGW is not a deduction, so each component is counted
  // exactly once.
  const expectedNet =
    value.grossCents -
    sumAmounts(value.salarySacrifice) -
    value.paygwCents -
    sumAmounts(value.deductions) +
    (value.reimbursementsCents ?? 0);

  if (value.netCents !== expectedNet) {
    ctx.addIssue({
      code: "custom",
      path: ["netCents"],
      message: `netCents must equal grossCents - salarySacrifice - paygwCents - deductions + reimbursementsCents (expected ${expectedNet}, got ${value.netCents})`,
    });
  }

  // Present means complete: an empty array would otherwise skip the check and
  // register an itemisation that says nothing while gross is non-zero. Omit
  // `earnings` entirely if you are not itemising.
  if (value.earnings !== undefined) {
    const itemised = sumAmounts(value.earnings);
    if (itemised !== value.grossCents) {
      ctx.addIssue({
        code: "custom",
        path: ["earnings"],
        message: `earnings must itemise grossCents in full (expected ${value.grossCents}, got ${itemised})`,
      });
    }
  }
});

export type PayslipNonPii = z.infer<typeof payslipNonPiiSchema>;

const basePayslipRegistrationSchema = z
  .object({
    /**
     * Payslip schema identifier. A literal, exactly as the API pins it on the
     * single-registration endpoints: `payslipNonPii` below IS the au.payslip.v1
     * shape, so accepting another identifier here would impose AU rules on a
     * payload that does not claim to be AU. When a second version ships, this
     * becomes a discriminated union keyed on `schema`, one member per version.
     */
    schema: z.literal("au.payslip.v1"),
    /**
     * ISO 8601 UTC datetime the payslip was issued. The API only accepts
     * UTC ("Z") timestamps; convert local times first, e.g. with
     * `new Date().toISOString()`.
     */
    issuedAt: z.iso.datetime({
      error:
        "issuedAt must be an ISO 8601 UTC datetime ending in 'Z' (use new Date().toISOString())",
    }),
    payslipNonPii: payslipNonPiiSchema,
    encryptionMetadata: encryptionMetadataSchema,
  })
  .strict();

/**
 * Request for `client.registerNonPii`. Calls POST /v1/registerNonPII.
 * The encrypted PII stays with you and goes into a locally generated
 * barcode; only non-PII data and decryption metadata are sent.
 */
export const registerNonPiiRequestSchema = basePayslipRegistrationSchema;

export type RegisterNonPiiRequest = z.infer<typeof registerNonPiiRequestSchema>;

export const registerNonPiiResponseSchema = z.object({
  /** 22-char base64url Verifiabl reference to embed in the barcode. */
  verifiablReference: verifiablReferenceSchema,
});

export type RegisterNonPiiResponse = z.infer<typeof registerNonPiiResponseSchema>;

/**
 * Request for `client.registerAndBuildBarcode`. Calls POST
 * /v1/registerAndBuildBarcode. This API-managed flow also sends the
 * ciphertext, and the server returns a ready-made barcode image.
 */
export const registerAndBuildBarcodeRequestSchema = basePayslipRegistrationSchema
  .extend({
    /** Base64url AES-256-GCM ciphertext of the formatted PII plaintext. */
    encryptedPii: z.string().min(1).max(10_000).regex(BASE64URL_RE),
  })
  .strict();

export type RegisterAndBuildBarcodeRequest = z.infer<typeof registerAndBuildBarcodeRequestSchema>;

export const barcodeImageSchema = z.object({
  format: z.literal("png"),
  /** Base64-encoded PNG. */
  data: z.string().min(1),
});

export type BarcodeImage = z.infer<typeof barcodeImageSchema>;

export const registerAndBuildBarcodeResponseSchema = z.object({
  /** 22-char base64url Verifiabl reference embedded in the returned barcode. */
  verifiablReference: verifiablReferenceSchema,
  barcode: barcodeImageSchema,
});

export type RegisterAndBuildBarcodeResponse = z.infer<typeof registerAndBuildBarcodeResponseSchema>;

/* ------------------------------------------------------------------ *
 * Wire translation                                                    *
 *                                                                     *
 * The HTTP API uses snake_case. These helpers convert the camelCase   *
 * SDK types to and from that wire shape at the network boundary, so   *
 * the public surface never exposes snake_case. Only SDK-defined keys  *
 * are renamed; provider-specific payslip fields pass through verbatim. *
 * ------------------------------------------------------------------ */

function encryptionMetadataToWire(metadata: EncryptionMetadata): Record<string, unknown> {
  return { iv: metadata.iv, tag: metadata.tag, key_version: metadata.keyVersion };
}

/** Include a key only when the value was supplied, so optionals stay absent rather than null. */
function when<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}

function earningsLineToWire(line: EarningsLine): Record<string, unknown> {
  return {
    type: line.type,
    ...(line.type === "paid_leave" ? { leave_type: line.leaveType } : {}),
    ...(line.type === "allowance"
      ? { allowance_type: line.allowanceType, ...when(line.otherCategory, "other_category") }
      : {}),
    amount_cents: line.amountCents,
    ...when(line.units, "units"),
    ...when(line.rateCents, "rate_cents"),
  };
}

/**
 * Map the canonical payslip to its snake_case wire form. The schema is closed,
 * so every field is mapped explicitly: there is no passthrough, and an unmapped
 * field would be a bug here rather than something the API silently accepts.
 */
function payslipNonPiiToWire(data: PayslipNonPii): Record<string, unknown> {
  return {
    period_start: data.periodStart,
    period_end: data.periodEnd,
    payment_date: data.paymentDate,
    currency: data.currency,
    gross_cents: data.grossCents,
    paygw_cents: data.paygwCents,
    net_cents: data.netCents,
    ytd_gross_cents: data.ytdGrossCents,
    ytd_paygw_cents: data.ytdPaygwCents,
    ...when(data.payFrequency, "pay_frequency"),
    ...when(data.employmentBasis, "employment_basis"),
    ...when(data.engagementType, "engagement_type"),
    ...(data.hourly === undefined
      ? {}
      : {
          hourly: {
            ordinary_rate_cents: data.hourly.ordinaryRateCents,
            hours: data.hourly.hours,
            amount_cents: data.hourly.amountCents,
          },
        }),
    ...when(data.annualRateCents, "annual_rate_cents"),
    ...when(data.taxableGrossCents, "taxable_gross_cents"),
    ...when(data.stslWithholdingCents, "stsl_withholding_cents"),
    ...(data.earnings === undefined ? {} : { earnings: data.earnings.map(earningsLineToWire) }),
    ...(data.salarySacrifice === undefined
      ? {}
      : {
          salary_sacrifice: data.salarySacrifice.map((line) => ({
            type: line.type,
            amount_cents: line.amountCents,
          })),
        }),
    ...(data.deductions === undefined
      ? {}
      : {
          deductions: data.deductions.map((line) => ({
            type: line.type,
            amount_cents: line.amountCents,
          })),
        }),
    ...(data.superannuation === undefined
      ? {}
      : {
          superannuation: data.superannuation.map((line) => ({
            contribution_type: line.contributionType,
            amount_cents: line.amountCents,
            ...when(line.usi, "usi"),
            ...when(line.fundAbn, "fund_abn"),
          })),
        }),
    ...when(data.reimbursementsCents, "reimbursements_cents"),
    ...(data.ytd === undefined
      ? {}
      : {
          ytd: {
            ...when(data.ytd.taxableCents, "taxable_cents"),
            ...when(data.ytd.superCents, "super_cents"),
            ...when(data.ytd.nonTaxableCents, "non_taxable_cents"),
            ...when(data.ytd.postTaxDeductionsCents, "post_tax_deductions_cents"),
            ...when(data.ytd.reimbursementsCents, "reimbursements_cents"),
          },
        }),
  };
}

/** Map a validated registration request to the snake_case wire body. */
export function registrationToWire(request: RegisterNonPiiRequest): Record<string, unknown> {
  return {
    schema: request.schema,
    issued_at: request.issuedAt,
    payslip_non_pii: payslipNonPiiToWire(request.payslipNonPii),
    encryption_metadata: encryptionMetadataToWire(request.encryptionMetadata),
  };
}

/** Map a validated register-and-build-barcode request to the snake_case wire body. */
export function registerAndBuildBarcodeToWire(
  request: RegisterAndBuildBarcodeRequest,
): Record<string, unknown> {
  return { ...registrationToWire(request), encrypted_pii: request.encryptedPii };
}

const registerNonPiiWireResponseSchema = z.object({
  verifiabl_reference: verifiablReferenceSchema,
});

/** Parse and map a registration response from the snake_case wire shape. */
export function registrationFromWire(value: unknown): RegisterNonPiiResponse {
  const wire = registerNonPiiWireResponseSchema.parse(value);
  return { verifiablReference: wire.verifiabl_reference };
}

const barcodeImageWireSchema = z.object({
  format: z.literal("png"),
  data: z.string().min(1),
});

const registerAndBuildBarcodeApiWireResponseSchema = z.object({
  verifiabl_reference: verifiablReferenceSchema,
  barcode: barcodeImageWireSchema,
});

/** Parse and map a register-and-build-barcode response from the snake_case wire shape. */
export function registerAndBuildBarcodeFromWire(value: unknown): RegisterAndBuildBarcodeResponse {
  const wire = registerAndBuildBarcodeApiWireResponseSchema.parse(value);
  return {
    verifiablReference: wire.verifiabl_reference,
    barcode: {
      format: wire.barcode.format,
      data: wire.barcode.data,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Batch registration                                                  *
 *                                                                     *
 * `registerNonPiiBatch` lets a pay run be submitted in one request.    *
 * The provider generates each record's reference up-front with         *
 * `generateVerifiablReference` and includes it in the record.          *
 * ------------------------------------------------------------------ */

/** Maximum records per batch request. Matches the API's MAX_BATCH_RECORDS. */
export const MAX_BATCH_RECORDS = 1000;

/** Longest accepted externalId. Matches the API's limit. */
const MAX_EXTERNAL_ID_LENGTH = 255;

/**
 * Optional caller-supplied correlation id for a batch record. The API echoes it
 * back verbatim in the matching result and never stores it, so you can line up
 * results (and error logs) with your own payslip records by your own id rather
 * than by array position. Printable ASCII, so it is safe to place in logs.
 */
const externalIdSchema = z
  .string()
  .min(1)
  .max(MAX_EXTERNAL_ID_LENGTH)
  .regex(/^[\x20-\x7e]+$/);

export const batchRecordRequestSchema = basePayslipRegistrationSchema
  .extend({
    verifiablReference: verifiablReferenceSchema,
    externalId: externalIdSchema.optional(),
  })
  .strict();

export type BatchRecordRequest = z.infer<typeof batchRecordRequestSchema>;

export const registerNonPiiBatchRequestSchema = z
  .object({
    records: z
      .array(batchRecordRequestSchema)
      .min(1, "records must contain at least one record")
      .max(MAX_BATCH_RECORDS, `records must contain at most ${MAX_BATCH_RECORDS} records`),
  })
  .strict();

export type RegisterNonPiiBatchRequest = z.infer<typeof registerNonPiiBatchRequestSchema>;

/**
 * Batch record with the payslip body left unvalidated, mirroring the API's own
 * batch envelope exactly: reference, schema id, timestamp and encryption
 * metadata are envelope-level and a bad one fails the request, while
 * `payslipNonPii` is checked per record so one non-conforming payslip becomes
 * that record's error result rather than costing the caller the whole pay run.
 */
const batchRecordEnvelopeSchema = basePayslipRegistrationSchema
  .extend({
    verifiablReference: verifiablReferenceSchema,
    externalId: externalIdSchema.optional(),
    payslipNonPii: z.unknown(),
    // Format-checked here, version-checked per record, as the API does: an
    // unsupported version is one record's error, not the whole batch's.
    schema: payslipSchemaIdSchema,
  })
  .strict();

/** The only payslip schema version this SDK can validate and map. */
export const SUPPORTED_PAYSLIP_SCHEMA = "au.payslip.v1";

export const registerNonPiiBatchEnvelopeSchema = z
  .object({
    records: z
      .array(batchRecordEnvelopeSchema)
      .min(1, "records must contain at least one record")
      .max(MAX_BATCH_RECORDS, `records must contain at most ${MAX_BATCH_RECORDS} records`),
  })
  .strict();

export type BatchRecordEnvelope = z.infer<typeof batchRecordEnvelopeSchema>;

/**
 * The error result for a record whose payslip the SDK rejected, in the same
 * shape the API returns for a record it rejects, so callers handle one type.
 * The detail carries the zod issue paths and messages, which name the field and
 * the expected shape but never the supplied value, so it is safe to log.
 */
export function localBatchValidationError(
  record: BatchRecordEnvelope,
  error: z.ZodError,
): BatchRecordResult {
  return {
    status: "error",
    code: "VALIDATION_FAILED",
    detail: error.issues
      .slice(0, 5)
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; "),
    verifiablReference: record.verifiablReference,
    ...(record.externalId !== undefined ? { externalId: record.externalId } : {}),
  };
}

/**
 * Per-record outcome statuses the API returns today: "created" for a newly
 * registered record, "duplicate" for an idempotent resend of identical
 * content, "error" for a per-record failure. Like the error codes, the API
 * may add statuses over time, so an unknown status flows through rather than
 * failing the whole response.
 */
export const KNOWN_BATCH_RECORD_STATUSES = tuple(["created", "duplicate", "error"]);

export type KnownBatchRecordStatus = (typeof KNOWN_BATCH_RECORD_STATUSES)[number];

/**
 * Per-record status. Typed as the known statuses plus `string` so a future
 * API status flows through to your handling untouched while autocomplete
 * still offers the known values.
 */
export type BatchRecordStatus = KnownBatchRecordStatus | (string & {});

/**
 * Per-record outcome, in the same order as the input `records` (so `results[i]`
 * is the outcome of `records[i]`). `code` and `detail` accompany an "error"
 * status. One bad record never fails the whole batch. Correlate by position, by
 * the record's `externalId` (echoed when supplied), or by `verifiablReference`.
 */
export interface BatchRecordResult {
  status: BatchRecordStatus;
  verifiablReference: string;
  /** Echoed back when the record supplied one. */
  externalId?: string;
  code?: string;
  detail?: string;
}

export interface RegisterNonPiiBatchResponse {
  results: BatchRecordResult[];
}

/** Map a validated batch request to the snake_case wire body. */
export function registerNonPiiBatchToWire(
  request: RegisterNonPiiBatchRequest,
): Record<string, unknown> {
  return {
    records: request.records.map((record) => ({
      verifiabl_reference: record.verifiablReference,
      ...(record.externalId !== undefined && { external_id: record.externalId }),
      ...registrationToWire({
        schema: record.schema,
        issuedAt: record.issuedAt,
        payslipNonPii: record.payslipNonPii,
        encryptionMetadata: record.encryptionMetadata,
      }),
    })),
  };
}

const batchRecordResultWireSchema = z.object({
  // Tolerant on purpose: an unknown status must pass through, not throw and
  // discard the whole batch response. Known values are listed in
  // KNOWN_BATCH_RECORD_STATUSES for callers to branch on.
  status: z.string(),
  verifiabl_reference: verifiablReferenceSchema,
  external_id: z.string().optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
});

const registerNonPiiBatchWireResponseSchema = z.object({
  results: z.array(batchRecordResultWireSchema),
});

/** Parse and map a batch response from the snake_case wire shape. */
export function registerNonPiiBatchFromWire(value: unknown): RegisterNonPiiBatchResponse {
  const wire = registerNonPiiBatchWireResponseSchema.parse(value);
  return {
    results: wire.results.map((result) => {
      const mapped: BatchRecordResult = {
        status: result.status,
        verifiablReference: result.verifiabl_reference,
      };
      if (result.external_id !== undefined) {
        mapped.externalId = result.external_id;
      }
      if (result.code !== undefined) {
        mapped.code = result.code;
      }
      if (result.detail !== undefined) {
        mapped.detail = result.detail;
      }
      return mapped;
    }),
  };
}

/**
 * Error codes the API is known to return today. The API may add codes
 * over time; treat anything not in this list as a generic failure rather
 * than rejecting the response.
 */
export const KNOWN_VERIFIABL_ERROR_CODES = tuple([
  "VALIDATION_FAILED",
  "DECRYPTION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "KEY_VERSION_UNAVAILABLE",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
]);

export type KnownVerifiablErrorCode = (typeof KNOWN_VERIFIABL_ERROR_CODES)[number];

/**
 * Stable machine-readable error code. Typed as the known codes plus
 * `string` so future API codes flow through to your error handling
 * untouched while autocomplete still offers the known values.
 */
export type VerifiablErrorCode = KnownVerifiablErrorCode | (string & {});

export const verifiablErrorDetailSchema = z.object({
  /** Dot-delimited field path, or "" when not field-specific. */
  path: z.string(),
  message: z.string(),
});

export type VerifiablErrorDetail = z.infer<typeof verifiablErrorDetailSchema>;

/**
 * Body shape of every non-2xx JSON response.
 *
 * The API returns per-field validation errors under the snake_case wire key
 * `field_errors`; the SDK surfaces them camelCase as `fieldErrors`, consistent
 * with the rest of the public surface. `fieldErrors` is omitted entirely when
 * the response carries none, so it is absent (not present-but-undefined) on
 * non-validation errors.
 */
export const verifiablErrorBodySchema = z.preprocess(
  // Rename the wire key `field_errors` to camelCase `fieldErrors`, dropping it
  // entirely when absent so the validated body has no present-but-undefined key.
  (value) => {
    if (typeof value !== "object" || value === null) return value;
    const { field_errors: fieldErrors, ...rest } = value as Record<string, unknown>;
    return fieldErrors === undefined ? rest : { ...rest, fieldErrors };
  },
  z.object({
    error: z.string(),
    code: z.string(),
    detail: z.string().optional(),
    fieldErrors: z.array(verifiablErrorDetailSchema).optional(),
  }),
);

export type VerifiablErrorBody = z.output<typeof verifiablErrorBodySchema>;
