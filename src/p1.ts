import { z } from "zod";

/**
 * P1 is Verifiabl's compact pipe-delimited PII plaintext format. It is the
 * string that gets encrypted and embedded in the payslip barcode. It is
 * never sent to the Verifiabl API in plaintext.
 *
 * Layout (8 segments, "P1" prefix + 7 fields, in this exact order):
 *
 *   P1|employee_name|position|department|employer_abn|bsb|account_number|account_name
 *
 * Example:
 *
 *   P1|Jane A. Doe|Senior Developer|Engineering|12-345-678-901|062-000|12345678|Jane A Doe
 *
 * Omitted fields are encoded as empty segments and skipped by the verifier.
 */

/** Field order is the wire contract. Never reorder. */
export const P1_FIELD_ORDER = [
  "employee_name",
  "position",
  "department",
  "employer_abn",
  "bsb",
  "account_number",
  "account_name",
] as const;

export type P1FieldName = (typeof P1_FIELD_ORDER)[number];

/**
 * Allow-list for a single P1 field value: any printable character except
 * the pipe delimiter and control characters. Pipes would corrupt the
 * positional layout; control characters have no place in PII fields.
 */
function isPrintableWithoutPipe(value: string): boolean {
  if (value.includes("|")) return false;
  return !/\p{Cc}/u.test(value);
}

const p1FieldSchema = z
  .string()
  .max(256, "P1 field exceeds 256 characters")
  .refine(isPrintableWithoutPipe, "P1 field must not contain '|' or control characters");

export const p1FieldsSchema = z
  .object({
    employee_name: p1FieldSchema.optional(),
    position: p1FieldSchema.optional(),
    department: p1FieldSchema.optional(),
    employer_abn: p1FieldSchema.optional(),
    bsb: p1FieldSchema.optional(),
    account_number: p1FieldSchema.optional(),
    account_name: p1FieldSchema.optional(),
  })
  .strict();

export type P1Fields = z.infer<typeof p1FieldsSchema>;

/**
 * Format employee PII into the P1 pipe-delimited plaintext string.
 *
 * The result is what you encrypt (see `encryptPii`) before embedding it in
 * a barcode. Throws `ZodError` if any field contains a pipe or control
 * character, or if an unknown field is supplied.
 */
export function formatP1(fields: P1Fields): string {
  const validated = p1FieldsSchema.parse(fields);
  const segments = P1_FIELD_ORDER.map((name) => validated[name] ?? "");
  return `P1|${segments.join("|")}`;
}

/**
 * Parse a P1 plaintext string back into named fields. Empty segments are
 * omitted from the result, mirroring the Verifiabl verifier's behaviour.
 *
 * Useful for round-trip testing your integration; not needed in the
 * normal issuance flow.
 */
export function parseP1(plaintext: string): P1Fields {
  if (!plaintext.startsWith("P1|")) {
    throw new Error("Not a P1 string: expected 'P1|' prefix");
  }
  const values = plaintext.slice(3).split("|");
  if (values.length !== P1_FIELD_ORDER.length) {
    throw new Error(`Expected ${P1_FIELD_ORDER.length} P1 fields but got ${values.length}`);
  }
  const result: P1Fields = {};
  for (let i = 0; i < P1_FIELD_ORDER.length; i++) {
    const value = values[i];
    const name = P1_FIELD_ORDER[i];
    if (name !== undefined && value !== undefined && value !== "") {
      result[name] = value;
    }
  }
  return p1FieldsSchema.parse(result);
}
