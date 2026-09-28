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

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

const PII_FIELD_DELIMITER = "|";
const PII_V1_VERSION = "P1";
const PII_V2_VERSION = "P2";
const AUSTRALIAN_PII_VERSION = AU2_MARKER;
const NEW_ZEALAND_PII_VERSION = NZ2_MARKER;
const PII_V1_PREFIX = `${PII_V1_VERSION}${PII_FIELD_DELIMITER}`;
const PII_V2_PREFIX = `${PII_V2_VERSION}${PII_FIELD_DELIMITER}`;

/**
 * Verifiabl's compact PII wire format is a pipe-delimited plaintext string.
 * It is encrypted before being embedded in the barcode and is never sent to
 * the Verifiabl API in plaintext.
 *
 * Current layout (9 segments, "P2" prefix + 8 fields, in this exact order):
 *
 *   P2|employeeName|position|department|employerAbn|bsb|accountNumber|accountName|address
 *
 * Example:
 *
 *   P2|Jane A. Doe|Senior Developer|Engineering|12345678901|062-000|12345678|Jane A Doe|12 Example St, Sydney NSW 2000
 *
 * Omitted fields are encoded as empty segments and skipped by Verifiabl.
 * Legacy P1 plaintext remains readable for existing documents, but cannot be generated.
 */

/** P1's field order is the wire contract for documents already issued. Never reorder. */
const P1_FIELD_ORDER = tuple([
  "employeeName",
  "position",
  "department",
  "employerAbn",
  "bsb",
  "accountNumber",
  "accountName",
]);

/** Field order is the current P2 wire contract. Never reorder. */
export const PII_FIELD_ORDER = tuple([...P1_FIELD_ORDER, "address"]);
type P2PiiFieldName = (typeof PII_FIELD_ORDER)[number];

export const AUSTRALIAN_PII_FIELD_ORDER = AU2_FIELD_ORDER;

export const NEW_ZEALAND_PII_FIELD_ORDER = NZ2_FIELD_ORDER;

export type PiiFieldName =
  | (typeof PII_FIELD_ORDER)[number]
  | (typeof AUSTRALIAN_PII_FIELD_ORDER)[number]
  | (typeof NEW_ZEALAND_PII_FIELD_ORDER)[number];

const PII_V1_FIELD_MAX_LENGTH = 256;

/** Maximum UTF-8 size of complete newly written P2 plaintext, including framing. */
export const PII_PAYLOAD_MAX_BYTES = 1024;

export const PII_TEXT_PROFILE_ID = "io.verifiabl.p2-pii-text.v1";
export const AUSTRALIAN_PII_TEXT_PROFILE_ID = AU2_TEXT_PROFILE_ID;
export const NEW_ZEALAND_PII_TEXT_PROFILE_ID = NZ2_TEXT_PROFILE_ID;

// Cc is permanently assigned to C0/C1. U+2028 and U+2029 are Zl/Zp rather
// than Cc, but are forbidden because every P2 field is one line.
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

function isCurrentText(value: string): boolean {
  return (
    !hasUnpairedSurrogate(value) &&
    !value.includes(PII_FIELD_DELIMITER) &&
    !containsControlOrLineCharacter(value) &&
    !containsFormatCharacter(value)
  );
}

function isLegacyText(value: string): boolean {
  return !value.includes(PII_FIELD_DELIMITER) && !containsControlOrLineCharacter(value);
}

const piiFieldSchema = z
  .string()
  .refine((value) => !hasUnpairedSurrogate(value), "PII field must contain valid Unicode")
  .refine(
    isCurrentText,
    "PII field must not contain '|', control characters, format characters or line separators",
  );

const addressSchema = z
  .string()
  .refine((value) => !hasUnpairedSurrogate(value), "Address must contain valid Unicode")
  .refine(isCurrentText, "Address must not contain '|', control, format or line separators");

export const piiFieldsSchema = z
  .object({
    employeeName: piiFieldSchema.optional(),
    position: piiFieldSchema.optional(),
    department: piiFieldSchema.optional(),
    employerAbn: piiFieldSchema.optional(),
    bsb: piiFieldSchema.optional(),
    accountNumber: piiFieldSchema.optional(),
    accountName: piiFieldSchema.optional(),
    address: addressSchema.optional(),
  })
  .strict();

export type PiiFields = z.infer<typeof piiFieldsSchema>;

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

/** A single field `formatPii` refused to encode, and why. */
export interface PiiFieldViolation {
  field: PiiFieldName;
  reason: PiiFieldViolationReason;
}

const VIOLATION_DESCRIPTIONS: Record<PiiFieldViolationReason, string> = {
  pipe: `must not contain '${PII_FIELD_DELIMITER}'`,
  "control-character": "must not contain control characters or line separators",
  "format-character": "must not contain format characters",
  "invalid-unicode": "must contain valid Unicode",
};

/**
 * Thrown by {@link formatPii} when a field value cannot be encoded in the PII
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

function fieldViolation(field: PiiFieldName, value: string): PiiFieldViolation | null {
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
 * field order. Non-object inputs and non-string values are left for
 * {@link piiFieldsSchema} to reject with its own (structural) ZodError, so
 * `formatPii`'s documented error contract holds for nullish callers too.
 */
function findPiiViolations(fields: PiiFields): PiiFieldViolation[] {
  const violations: PiiFieldViolation[] = [];
  if (typeof fields !== "object" || fields === null) {
    return violations;
  }
  for (const field of PII_FIELD_ORDER) {
    const value = fields[field];
    if (typeof value !== "string") continue;
    const violation = fieldViolation(field, value);
    if (violation !== null) violations.push(violation);
  }
  return violations;
}

/**
 * Format employee PII into Verifiabl's current P2 compact plaintext wire format.
 *
 * The result is what you encrypt with `encryptPii` before embedding it in
 * a barcode. Throws {@link PiiValidationError} if any field contains content
 * that cannot be encoded. Each such value must be corrected at the source, as
 * the format has no escape mechanism. Throws `ZodError` for structural problems
 * (unknown field, non-string value).
 */
export function formatPii(fields: PiiFields): string {
  const violations = findPiiViolations(fields);
  if (violations.length > 0) {
    throw new PiiValidationError(violations);
  }
  const validated = piiFieldsSchema.parse(fields);
  const segments = PII_FIELD_ORDER.map((name) => validated[name] ?? "");
  const plaintext = PII_V2_PREFIX + segments.join(PII_FIELD_DELIMITER);
  if (Buffer.byteLength(plaintext, "utf8") > PII_PAYLOAD_MAX_BYTES) {
    throw new RangeError(`P2 plaintext exceeds ${PII_PAYLOAD_MAX_BYTES} UTF-8 bytes`);
  }
  return plaintext;
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

/** Format Australian employee PII as fixed-arity AU2 plaintext. */
export function formatAustralianPii(fields: AustralianPiiFields): string {
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

/** Format New Zealand employee PII as fixed-arity NZ2 plaintext. */
export function formatNewZealandPii(fields: NewZealandPiiFields): string {
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

const PII_LAYOUTS: ReadonlyArray<{
  version: string;
  order: readonly P2PiiFieldName[];
  currentValidation: boolean;
}> = [
  { version: PII_V1_VERSION, order: P1_FIELD_ORDER, currentValidation: false },
  { version: PII_V2_VERSION, order: PII_FIELD_ORDER, currentValidation: true },
];

function validateParsedValue(
  field: P2PiiFieldName,
  value: string,
  currentValidation: boolean,
): void {
  if (field === "address") {
    addressSchema.parse(value);
    return;
  }
  if (currentValidation) {
    piiFieldSchema.parse(value);
    return;
  }
  if (value.length > PII_V1_FIELD_MAX_LENGTH || !isLegacyText(value)) {
    throw new Error(`PII field '${field}' is not a valid field value`);
  }
}

/**
 * Parse Verifiabl's compact PII wire format, P2 or P1, back into named fields.
 * Empty segments are omitted from the result, mirroring Verifiabl's scan-time
 * behaviour.
 *
 * Useful for round-trip testing your integration; not needed in the
 * normal issuance flow.
 */
export function parsePii(plaintext: string): PiiFields {
  for (const { version, order, currentValidation } of PII_LAYOUTS) {
    const prefix = `${version}${PII_FIELD_DELIMITER}`;
    if (!plaintext.startsWith(prefix)) {
      continue;
    }

    const values = plaintext.slice(prefix.length).split(PII_FIELD_DELIMITER);
    if (values.length !== order.length) {
      throw new Error(`Expected ${order.length} ${version} fields but got ${values.length}`);
    }

    const result: PiiFields = {};
    for (let i = 0; i < order.length; i++) {
      const value = values[i];
      const name = order[i];
      if (name !== undefined && value !== undefined && value !== "") {
        validateParsedValue(name, value, currentValidation);
        result[name] = value;
      }
    }
    return result;
  }

  throw new Error(`Invalid PII format: expected '${PII_V1_PREFIX}' or '${PII_V2_PREFIX}' prefix`);
}
