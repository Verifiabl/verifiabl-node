import { z } from "zod";
import {
  AU2_FIELD_ORDER,
  AU2_MARKER,
  AU2_TEXT_PROFILE_ID,
  JURISDICTION_PII_MAX_BYTES,
  NZ2_FIELD_ORDER,
  NZ2_MARKER,
  NZ2_TEXT_PROFILE_ID,
} from "./generated/jurisdictionPiiProfiles.js";
import {
  PII_FORMAT_CHARACTER_RANGES,
  PII_TEXT_PROFILE_UNICODE_VERSION,
} from "./generated/piiTextProfile.js";

export { PII_TEXT_PROFILE_UNICODE_VERSION };

const PII_FIELD_DELIMITER = "|";
const AUSTRALIAN_PII_VERSION = AU2_MARKER;
const NEW_ZEALAND_PII_VERSION = NZ2_MARKER;

/**
 * Verifiabl's compact PII wire format is a pipe-delimited plaintext string.
 * It is encrypted before being embedded in the barcode and is never sent to
 * the Verifiabl API in plaintext.
 *
 * {@link formatAustralianPii} writes the AU2 profile and
 * {@link formatNewZealandPii} writes the NZ2 profile. Each writes its marker
 * and then eight fields in the profile's fixed order, preserving empty
 * trailing fields:
 *
 *   AU2|employeeName|position|department|employerIdentity|bsb|accountNumber|accountName|address
 *   NZ2|employeeName|irdNumber|position|department|employerName|accountNumber|accountName|address
 */

/** AU2 field order. Never reorder. */
export const AUSTRALIAN_PII_FIELD_ORDER = AU2_FIELD_ORDER;

/** NZ2 field order. Never reorder. */
export const NEW_ZEALAND_PII_FIELD_ORDER = NZ2_FIELD_ORDER;

/** An AU2 or NZ2 input field name or field position. */
export type PiiFieldName =
  | keyof AustralianPiiFields
  | keyof NewZealandPiiFields
  | (typeof AUSTRALIAN_PII_FIELD_ORDER)[number]
  | (typeof NEW_ZEALAND_PII_FIELD_ORDER)[number];

export const AUSTRALIAN_PII_TEXT_PROFILE_ID = AU2_TEXT_PROFILE_ID;
export const NEW_ZEALAND_PII_TEXT_PROFILE_ID = NZ2_TEXT_PROFILE_ID;

// Cc is permanently assigned to C0/C1. U+2028 and U+2029 are Zl/Zp rather
// than Cc, but are forbidden because every PII field is one line.
function containsControlOrLineCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true;
    }
  }
  return false;
}

function containsFormatCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      PII_FORMAT_CHARACTER_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
    ) {
      return true;
    }
  }
  return false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
      return true;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isPiiText(value: string): boolean {
  return (
    !hasUnpairedSurrogate(value) &&
    !value.includes(PII_FIELD_DELIMITER) &&
    !containsControlOrLineCharacter(value) &&
    !containsFormatCharacter(value)
  );
}

const piiFieldSchema = z
  .string()
  .refine((value) => !hasUnpairedSurrogate(value), "PII field must contain valid Unicode")
  .refine(
    isPiiText,
    "PII field must not contain '|', control characters, format characters or line separators",
  );

export const australianAddressSchema = z
  .object({
    lines: z.array(piiFieldSchema).optional(),
    suburb: piiFieldSchema.optional(),
    stateOrTerritory: piiFieldSchema.optional(),
    postcode: piiFieldSchema.optional(),
  })
  .strict();

export const australianPiiFieldsSchema = z
  .object({
    employeeName: piiFieldSchema.optional(),
    position: piiFieldSchema.optional(),
    department: piiFieldSchema.optional(),
    employerName: piiFieldSchema.optional(),
    employerAbn: piiFieldSchema.optional(),
    bsb: piiFieldSchema.optional(),
    accountNumber: piiFieldSchema.optional(),
    accountName: piiFieldSchema.optional(),
    address: australianAddressSchema.optional(),
  })
  .strict();

export type AustralianAddress = z.infer<typeof australianAddressSchema>;
export type AustralianPiiFields = z.infer<typeof australianPiiFieldsSchema>;

export const newZealandAddressSchema = z
  .object({
    lines: z.array(piiFieldSchema).optional(),
    suburb: piiFieldSchema.optional(),
    city: piiFieldSchema.optional(),
    postcode: piiFieldSchema.optional(),
  })
  .strict();

export const newZealandPiiFieldsSchema = z
  .object({
    employeeName: piiFieldSchema.optional(),
    irdNumber: piiFieldSchema.optional(),
    position: piiFieldSchema.optional(),
    department: piiFieldSchema.optional(),
    employerName: piiFieldSchema.optional(),
    accountNumber: piiFieldSchema.optional(),
    accountName: piiFieldSchema.optional(),
    address: newZealandAddressSchema.optional(),
  })
  .strict();

export type NewZealandAddress = z.infer<typeof newZealandAddressSchema>;
export type NewZealandPiiFields = z.infer<typeof newZealandPiiFieldsSchema>;

/** Why a PII field value cannot be encoded in the PII wire format. */
export type PiiFieldViolationReason =
  | "pipe"
  | "control-character"
  | "format-character"
  | "invalid-unicode";

/** A supplied PII field a formatter refused to encode, and why. */
export interface PiiFieldViolation {
  /** Input field name, or a structured address path such as `address.lines[0]`. */
  field:
    | PiiFieldName
    | `address.${Exclude<keyof AustralianAddress | keyof NewZealandAddress, "lines">}`
    | `address.lines[${number}]`;
  reason: PiiFieldViolationReason;
}

const VIOLATION_DESCRIPTIONS: Record<PiiFieldViolationReason, string> = {
  pipe: `must not contain '${PII_FIELD_DELIMITER}'`,
  "control-character": "must not contain control characters or line separators",
  "format-character": "must not contain format characters",
  "invalid-unicode": "must contain valid Unicode",
};

/**
 * Thrown by {@link formatAustralianPii} and {@link formatNewZealandPii} when a field value cannot be encoded in the PII
 * wire format. The pipe is the field delimiter and the format has no escape
 * mechanism, so an offending value must be corrected at the source (strip the
 * character) rather than escaped. `violations` names each field and reason so
 * callers can guide the user without echoing the value, which is PII.
 */
export class PiiValidationError extends Error {
  readonly violations: readonly PiiFieldViolation[];

  constructor(violations: readonly PiiFieldViolation[]) {
    const detail = violations
      .map((v) => `${v.field} ${VIOLATION_DESCRIPTIONS[v.reason]}`)
      .join("; ");
    super(`Invalid PII field${violations.length === 1 ? "" : "s"}: ${detail}`);
    this.name = "PiiValidationError";
    this.violations = violations;
    Object.setPrototypeOf(this, PiiValidationError.prototype);
  }
}

function fieldViolation(
  field: PiiFieldViolation["field"],
  value: string,
): PiiFieldViolation | null {
  if (hasUnpairedSurrogate(value)) {
    return { field, reason: "invalid-unicode" };
  }
  if (value.includes(PII_FIELD_DELIMITER)) {
    return { field, reason: "pipe" };
  }
  if (containsControlOrLineCharacter(value)) {
    return { field, reason: "control-character" };
  }
  if (containsFormatCharacter(value)) {
    return { field, reason: "format-character" };
  }
  return null;
}

/**
 * Inspect each supplied field for content the wire format cannot carry, in
 * field order. Non-object inputs and non-string values are left for the
 * formatter's Zod schema to reject with its own (structural) ZodError, so the
 * documented error contract holds for nullish callers too.
 */
function findPiiViolations(
  fields: unknown,
  fieldNames: readonly PiiFieldName[],
): PiiFieldViolation[] {
  const violations: PiiFieldViolation[] = [];
  if (!isFieldObject(fields)) {
    return violations;
  }
  for (const field of fieldNames) {
    const value = fields[field];
    if (typeof value !== "string") continue;
    const violation = fieldViolation(field, value);
    if (violation !== null) violations.push(violation);
  }
  return violations;
}

function isFieldObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Inspect only allowed input fields; leave malformed structures to Zod. */
function validateJurisdictionPiiText(
  fields: unknown,
  fieldNames: readonly PiiFieldName[],
  addressNames: readonly (keyof AustralianAddress | keyof NewZealandAddress)[],
): void {
  const violations = findPiiViolations(
    fields,
    fieldNames.filter((name) => name !== "address"),
  );
  const address = isFieldObject(fields) ? fields.address : undefined;
  if (isFieldObject(address)) {
    for (const name of addressNames) {
      const value = address[name];
      if (name === "lines") {
        if (!Array.isArray(value)) continue;
        for (const [index, line] of value.entries()) {
          if (typeof line !== "string") continue;
          const violation = fieldViolation(`address.lines[${index}]`, line);
          if (violation !== null) violations.push(violation);
        }
      } else if (typeof value === "string") {
        const violation = fieldViolation(`address.${name}`, value);
        if (violation !== null) violations.push(violation);
      }
    }
  }
  if (violations.length > 0) throw new PiiValidationError(violations);
}

function nonEmpty(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value.length > 0);
}

function formatAustralianAddress(address: AustralianAddress | undefined): string {
  if (address === undefined) return "";
  const locality = nonEmpty([address.suburb, address.stateOrTerritory, address.postcode]).join(" ");
  return [...nonEmpty(address.lines ?? []), ...nonEmpty([locality])].join(", ");
}

function formatNewZealandAddress(address: NewZealandAddress | undefined): string {
  if (address === undefined) return "";
  const city = nonEmpty([address.city, address.postcode]).join(" ");
  return [...nonEmpty(address.lines ?? []), ...nonEmpty([address.suburb, city])].join(", ");
}

function formatCurrentProfile(version: string, segments: readonly string[]): string {
  const plaintext = `${version}${PII_FIELD_DELIMITER}${segments.join(PII_FIELD_DELIMITER)}`;
  if (Buffer.byteLength(plaintext, "utf8") > JURISDICTION_PII_MAX_BYTES) {
    throw new RangeError(`${version} plaintext exceeds ${JURISDICTION_PII_MAX_BYTES} UTF-8 bytes`);
  }
  return plaintext;
}

/**
 * Format Australian employee PII as fixed-arity AU2 plaintext.
 * Throws {@link PiiValidationError} for forbidden text, including address parts,
 * `ZodError` for structural problems, and `RangeError` for the UTF-8 size limit.
 */
export function formatAustralianPii(fields: AustralianPiiFields): string {
  validateJurisdictionPiiText(
    fields,
    australianPiiFieldsSchema.keyof().options,
    australianAddressSchema.keyof().options,
  );
  const validated = australianPiiFieldsSchema.parse(fields);
  const employerIdentity =
    validated.employerAbn === undefined || validated.employerAbn.length === 0
      ? (validated.employerName ?? "")
      : validated.employerAbn;
  const values: Record<(typeof AU2_FIELD_ORDER)[number], string> = {
    employeeName: validated.employeeName ?? "",
    position: validated.position ?? "",
    department: validated.department ?? "",
    employerIdentity,
    bsb: validated.bsb ?? "",
    accountNumber: validated.accountNumber ?? "",
    accountName: validated.accountName ?? "",
    address: formatAustralianAddress(validated.address),
  };
  return formatCurrentProfile(
    AUSTRALIAN_PII_VERSION,
    AU2_FIELD_ORDER.map((field) => values[field]),
  );
}

/**
 * Format New Zealand employee PII as fixed-arity NZ2 plaintext.
 * Throws {@link PiiValidationError} for forbidden text, including address parts,
 * `ZodError` for structural problems, and `RangeError` for the UTF-8 size limit.
 */
export function formatNewZealandPii(fields: NewZealandPiiFields): string {
  validateJurisdictionPiiText(
    fields,
    newZealandPiiFieldsSchema.keyof().options,
    newZealandAddressSchema.keyof().options,
  );
  const validated = newZealandPiiFieldsSchema.parse(fields);
  const values: Record<(typeof NZ2_FIELD_ORDER)[number], string> = {
    employeeName: validated.employeeName ?? "",
    irdNumber: validated.irdNumber ?? "",
    position: validated.position ?? "",
    department: validated.department ?? "",
    employerName: validated.employerName ?? "",
    accountNumber: validated.accountNumber ?? "",
    accountName: validated.accountName ?? "",
    address: formatNewZealandAddress(validated.address),
  };
  return formatCurrentProfile(
    NEW_ZEALAND_PII_VERSION,
    NZ2_FIELD_ORDER.map((field) => values[field]),
  );
}
