import {
  createBarcodeSvg,
  prepareAustralianV2Payslip,
  prepareNewZealandV2Payslip,
  type VerifiablClient,
} from "@verifiabl/issuer";

/** Example: prepare once, persist registration and ciphertext, then register. */
export async function issuePreparedV2(client: VerifiablClient, key: Buffer) {
  const issuedAt = new Date().toISOString();
  const au = prepareAustralianV2Payslip({
    pii: { employeeName: "Example Employee", employerName: "Example Pty Ltd" },
    payslipNonPii: {
      periodEnd: "2026-08-31",
      paymentDate: "2026-09-04",
      currency: "AUD",
      gross: "9000.00",
      paygw: "2250.00",
      net: "6750.00",
    },
    issuedAt,
    key,
  });
  // Atomically persist au.registration and
  // au.barcodeParts(au.verifiablReference).encryptedPii before sending.
  // After a restart, resend the *same* registration and render with the saved ciphertext.
  const result = await client.registerNonPii(au.registration);
  const svg = createBarcodeSvg(au.barcodeParts(result.verifiablReference), {
    environment: "sandbox",
  });

  const nz = prepareNewZealandV2Payslip({
    pii: { employeeName: "Example Employee", employerName: "Example NZ Ltd" },
    payslipNonPii: {
      periodEnd: "2026-08-31",
      paymentDate: "2026-09-04",
      currency: "NZD",
      gross: "7600.00",
      paye: "1710.00",
      net: "5890.00",
    },
    issuedAt,
    key,
  });
  // API-managed issuance does not send nz.verifiablReference; the server allocates one.
  // Do not automatically replay an ambiguous API-managed failure.
  const apiManaged = await client.registerAndBuildBarcode(nz.apiManagedRegistration);
  // For pay runs instead: client.registerNonPiiBatch({ records: [
  //   { ...au.registration, verifiablReference: au.verifiablReference, externalId: "PAY-1" },
  // ] }); pair each result with its own prepared.barcodeParts(result.verifiablReference).
  return { svg, apiManaged };
}
