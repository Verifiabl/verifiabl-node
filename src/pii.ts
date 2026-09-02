import { z } from "zod";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

const PII_FIELD_DELIMITER = "|";
const PII_V1_VERSION = "P1";
const PII_V2_VERSION = "P2";
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
 * P1 remains available through `formatPiiV1` for rollback and is parsed permanently.
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

export type PiiFieldName = (typeof PII_FIELD_ORDER)[number];

/**
 * Round per-field sanity cap in UTF-16 code units, not bytes. It is not derived
 * from QR capacity and does not bound it. Total plaintext is the real budget,
 * so recheck it before adding fields.
 */
export const PII_FIELD_MAX_LENGTH = 256;

/** Maximum UTF-8 size of the optional P2 address. */
export const PII_ADDRESS_MAX_BYTES = 320;

// U+2028 and U+2029 are separators, not Cc, so a Cc-only test misses them even
// though they break a field just as a newline would. P2 also rejects Unicode
// format characters so hidden formatting state does not enter new payloads.
const DISALLOWED_TEXT_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const DISALLOWED_LEGACY_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

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
    !DISALLOWED_TEXT_CHARACTERS.test(value)
  );
}

function isLegacyText(value: string): boolean {
  return !value.includes(PII_FIELD_DELIMITER) && !DISALLOWED_LEGACY_CHARACTERS.test(value);
}

const piiFieldSchema = z
  .string()
  .max(PII_FIELD_MAX_LENGTH, `PII field exceeds ${PII_FIELD_MAX_LENGTH} characters`)
  .refine((value) => !hasUnpairedSurrogate(value), "PII field must contain valid Unicode")
  .refine(
    isCurrentText,
    "PII field must not contain '|', control characters, format characters or line separators",
  );

const addressSchema = z
  .string()
  .refine((value) => !hasUnpairedSurrogate(value), "Address must contain valid Unicode")
  .refine(isCurrentText, "Address must not contain '|', control, format or line separators")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= PII_ADDRESS_MAX_BYTES,
    `Address exceeds ${PII_ADDRESS_MAX_BYTES} UTF-8 bytes`,
  );

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

/** Why a PII field value cannot be encoded in the PII wire format. */
export type PiiFieldViolationReason =
  | "pipe"
  | "control-character"
  | "format-character"
  | "invalid-unicode"
  | "too-long"
  | "too-many-bytes";

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
  "too-long": `exceeds ${PII_FIELD_MAX_LENGTH} characters`,
  "too-many-bytes": `exceeds ${PII_ADDRESS_MAX_BYTES} UTF-8 bytes`,
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
  if (field === "address" && Buffer.byteLength(value, "utf8") > PII_ADDRESS_MAX_BYTES) {
    return { field, reason: "too-many-bytes" };
  }
  if (field !== "address" && value.length > PII_FIELD_MAX_LENGTH) {
    return { field, reason: "too-long" };
  }
  if (value.includes(PII_FIELD_DELIMITER)) {
    return { field, reason: "pipe" };
  }
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) {
    return { field, reason: "control-character" };
  }
  if (/\p{Cf}/u.test(value)) {
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
  return PII_V2_PREFIX + segments.join(PII_FIELD_DELIMITER);
}

/**
 * Format the permanent legacy P1 plaintext for rollback. New documents use
 * {@link formatPii}.
 */
export function formatPiiV1(fields: Omit<PiiFields, "address">): string {
  if (typeof fields === "object" && fields !== null) {
    for (const field of P1_FIELD_ORDER) {
      const value = fields[field];
      if (typeof value !== "string") continue;
      if (value.length > PII_FIELD_MAX_LENGTH || !isLegacyText(value)) {
        throw new PiiValidationError([
          fieldViolation(field, value) ?? { field, reason: "too-long" },
        ]);
      }
    }
  }
  const validated = piiFieldsSchema.omit({ address: true }).parse(fields);
  const segments = P1_FIELD_ORDER.map((name) => validated[name] ?? "");
  return PII_V1_PREFIX + segments.join(PII_FIELD_DELIMITER);
}

const PII_LAYOUTS: ReadonlyArray<{
  version: string;
  order: readonly PiiFieldName[];
  currentValidation: boolean;
}> = [
  { version: PII_V1_VERSION, order: P1_FIELD_ORDER, currentValidation: false },
  { version: PII_V2_VERSION, order: PII_FIELD_ORDER, currentValidation: true },
];

function validateParsedValue(field: PiiFieldName, value: string, currentValidation: boolean): void {
  if (field === "address") {
    addressSchema.parse(value);
    return;
  }
  if (currentValidation) {
    piiFieldSchema.parse(value);
    return;
  }
  if (value.length > PII_FIELD_MAX_LENGTH || !isLegacyText(value)) {
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
