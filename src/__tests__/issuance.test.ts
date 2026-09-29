import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareAustralianV2Payslip, prepareNewZealandV2Payslip } from "../issuance.js";
import { buildBarcodePayload } from "../payload.js";
import {
  registerAndBuildBarcodeToWire,
  registerNonPiiBatchToWire,
  registrationToWire,
} from "../types.js";

const key = randomBytes(32);
const issuedAt = "2026-09-04T00:00:00.000Z";
const au = {
  periodEnd: "2026-08-31",
  paymentDate: "2026-09-04",
  currency: "AUD",
  gross: "9000.00",
  paygw: "2250.00",
  net: "6750.00",
} as const;
const nz = {
  periodEnd: "2026-08-31",
  paymentDate: "2026-09-04",
  currency: "NZD",
  gross: "7600.00",
  paye: "1710.00",
  net: "5890.00",
} as const;

describe("v2 issuance preparation", () => {
  it.each([
    [prepareAustralianV2Payslip, { employerName: "Private AU" }, au, "au.payslip.v2"],
    [prepareNewZealandV2Payslip, { employeeName: "Private NZ" }, nz, "nz.payslip.v2"],
  ] as const)(
    "pairs %s with its v2 schema for both flows and batches",
    (prepare, pii, payslip, schema) => {
      const prepared = prepare({ pii, payslipNonPii: payslip, issuedAt, key } as never);
      expect(prepared.registration.schema).toBe(schema);
      expect(prepared.registration.verifiablReference).toBe(prepared.verifiablReference);
      expect(prepared.apiManagedRegistration).not.toHaveProperty("verifiablReference");
      expect(registerAndBuildBarcodeToWire(prepared.apiManagedRegistration)).not.toHaveProperty(
        "verifiabl_reference",
      );
      expect(registrationToWire(prepared.registration)).toHaveProperty("schema", schema);
      const parts = prepared.barcodeParts(prepared.verifiablReference);
      expect(parts.encryptedPii).toEqual(prepared.apiManagedRegistration.encryptedPii);
      expect(prepared.barcodeParts(prepared.verifiablReference)).toEqual(parts);
      expect(prepared.registration.encryptionMetadata.iv).toHaveLength(12);
      expect(prepared.registration.encryptionMetadata.tag).toHaveLength(16);
      expect(
        registerNonPiiBatchToWire({
          records: [
            {
              ...prepared.registration,
              verifiablReference: prepared.verifiablReference,
              externalId: "PAY-1",
            },
          ],
        }),
      ).toHaveProperty("records.0.schema", schema);
    },
  );

  it("can retry and render after losing the prepared object if registration and ciphertext were saved", () => {
    const prepared = prepareAustralianV2Payslip({
      pii: { employeeName: "Private" },
      payslipNonPii: au,
      issuedAt,
      key,
    });
    const savedRegistration = structuredClone(prepared.registration);
    const savedCiphertext = Buffer.from(
      prepared.barcodeParts(prepared.verifiablReference).encryptedPii,
    );
    const expected = buildBarcodePayload(prepared.barcodeParts(prepared.verifiablReference));

    // Simulate a restart: only independently persisted values remain.
    const restoredRegistration = structuredClone(savedRegistration);
    const restoredCiphertext = new Uint8Array(Buffer.from(savedCiphertext));
    expect(registrationToWire(restoredRegistration)).toEqual(
      registrationToWire(prepared.registration),
    );
    expect(
      buildBarcodePayload({
        verifiablReference: restoredRegistration.verifiablReference ?? "",
        encryptedPii: restoredCiphertext,
      }),
    ).toBe(expected);
  });

  it("keeps the reference for retries and draws a new IV on a new preparation", () => {
    const first = prepareAustralianV2Payslip({ pii: {}, payslipNonPii: au, issuedAt, key });
    const second = prepareAustralianV2Payslip({
      pii: {},
      payslipNonPii: au,
      issuedAt,
      key,
      verifiablReference: first.verifiablReference,
    });
    expect(second.verifiablReference).toBe(first.verifiablReference);
    expect(second.registration.encryptionMetadata.iv).not.toEqual(
      first.registration.encryptionMetadata.iv,
    );
    expect(first.registration).toEqual(first.registration);
    expect(first.registration).not.toBe(first.registration);
  });

  it("does not let mutations of inputs or returned values change a prepared issuance", () => {
    const payslip = { ...au, ytd: { taxable: "9000.00" } };
    const prepared = prepareAustralianV2Payslip({ pii: {}, payslipNonPii: payslip, issuedAt, key });
    const registration = prepared.registration;
    const apiManaged = prepared.apiManagedRegistration;
    const parts = prepared.barcodeParts(prepared.verifiablReference);
    const expectedRegistration = registrationToWire(prepared.registration);
    const expectedApiManaged = registerAndBuildBarcodeToWire(prepared.apiManagedRegistration);
    const expectedCiphertext = prepared.barcodeParts(prepared.verifiablReference).encryptedPii;

    payslip.ytd.taxable = "1.00";
    (registration.payslipNonPii as typeof payslip).ytd.taxable = "2.00";
    registration.encryptionMetadata.iv.fill(0);
    registration.encryptionMetadata.tag.fill(0);
    (apiManaged.payslipNonPii as typeof payslip).ytd.taxable = "3.00";
    apiManaged.encryptionMetadata.iv.fill(0);
    apiManaged.encryptionMetadata.tag.fill(0);
    apiManaged.encryptedPii.fill(0);
    parts.encryptedPii.fill(0);

    expect(registrationToWire(prepared.registration)).toEqual(expectedRegistration);
    expect(registerAndBuildBarcodeToWire(prepared.apiManagedRegistration)).toEqual(
      expectedApiManaged,
    );
    expect(prepared.barcodeParts(prepared.verifiablReference).encryptedPii).toEqual(
      expectedCiphertext,
    );
    expect(prepared.registration.verifiablReference).toBe(prepared.verifiablReference);
    expect(prepared.apiManagedRegistration).not.toHaveProperty("verifiablReference");
  });

  it("rejects NZ non-PII with AU PII before encryption, without quoting private values", () => {
    expect(() =>
      prepareAustralianV2Payslip({
        pii: { employeeName: "Private Person" },
        payslipNonPii: nz as never,
        issuedAt,
        key: Buffer.alloc(1),
      }),
    ).toThrow(/payslipNonPii/);
    try {
      prepareAustralianV2Payslip({
        pii: { employeeName: "Private Person" },
        payslipNonPii: nz as never,
        issuedAt,
        key,
      });
    } catch (error) {
      expect(String(error)).not.toContain("Private Person");
    }
    expect(() =>
      prepareAustralianV2Payslip({
        pii: { employeeName: "Private Person", irdNumber: "secret" } as never,
        payslipNonPii: au,
        issuedAt,
        key,
      }),
    ).toThrow(/pii/);
  });
});
