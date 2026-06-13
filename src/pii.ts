import { z } from "zod";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

/**
 * Verifiabl's compact PII wire format is a pipe-delimited plaintext string.
 * It is encrypted before being embedded in the barcode and is never sent to
 * the Verifiabl API in plaintext.
 *
 * Layout (8 segments, "P1" prefix + 7 fields, in this exact order):
 *
 *   P1|employee_name|position|department|employer_abn|bsb|account_number|account_name
 *
 * Example:
 *
 *   P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe
 *
 * Omitted fields are encoded as empty segments and skipped by Verifiabl.
 */

/** Field order is the wire contract. Never reorder. */
export const PII_FIELD_ORDER = tuple([
  "employee_name",
  "position",
  "department",
  "employer_abn",
  "bsb",
  "account_number",
  "account_name",
]);

export type PiiFieldName = (typeof PII_FIELD_ORDER)[number];

/**
 * Allow-list for a single PII field value: any printable character except
 * the pipe delimiter and control characters. Pipes would corrupt the
 * positional layout; control characters have no place in PII fields.
 */
function isPrintableWithoutPipe(value: string): boolean {
  if (value.includes("|")) return false;
  return !/\p{Cc}/u.test(value);
}

const piiFieldSchema = z
  .string()
  .max(256, "PII field exceeds 256 characters")
  .refine(isPrintableWithoutPipe, "PII field must not contain '|' or control characters");

export const piiFieldsSchema = z
  .object({
    employee_name: piiFieldSchema.optional(),
    position: piiFieldSchema.optional(),
    department: piiFieldSchema.optional(),
    employer_abn: piiFieldSchema.optional(),
    bsb: piiFieldSchema.optional(),
    account_number: piiFieldSchema.optional(),
    account_name: piiFieldSchema.optional(),
  })
  .strict();

export type PiiFields = z.infer<typeof piiFieldsSchema>;

/**
 * Format employee PII into Verifiabl's compact plaintext wire format.
 *
 * The result is what you encrypt with `encryptPii` before embedding it in
 * a barcode. Throws `ZodError` if any field contains a pipe or control
 * character, or if an unknown field is supplied.
 */
export function formatPii(fields: PiiFields): string {
  const validated = piiFieldsSchema.parse(fields);
  const segments = PII_FIELD_ORDER.map((name) => validated[name] ?? "");
  return `P1|${segments.join("|")}`;
}

/**
 * Parse Verifiabl's compact PII wire format back into named fields. Empty segments are
 * omitted from the result, mirroring Verifiabl's scan-time behaviour.
 *
 * Useful for round-trip testing your integration; not needed in the
 * normal issuance flow.
 */
export function parsePii(plaintext: string): PiiFields {
  if (!plaintext.startsWith("P1|")) {
    throw new Error("Invalid PII format: expected 'P1|' prefix");
  }
  const values = plaintext.slice(3).split("|");
  if (values.length !== PII_FIELD_ORDER.length) {
    throw new Error(`Expected ${PII_FIELD_ORDER.length} PII fields but got ${values.length}`);
  }
  const result: PiiFields = {};
  for (let i = 0; i < PII_FIELD_ORDER.length; i++) {
    const value = values[i];
    const name = PII_FIELD_ORDER[i];
    if (name !== undefined && value !== undefined && value !== "") {
      result[name] = value;
    }
  }
  return piiFieldsSchema.parse(result);
}
