import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AUSTRALIAN_PAYSLIP_V2_SCHEMA,
  type AustralianPayslipV2,
  buildBarcodePayload,
  buildScanUrl,
  createBarcodeSvg,
  encryptPii,
  formatAustralianPii,
  formatNewZealandPii,
  generateVerifiablReference,
  NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
  type NewZealandPayslipV2,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PROPERTY,
  type RegisterNonPiiRequest,
  VerifiablClient,
} from "@verifiabl/issuer";

type Mode = "offline" | "live";

type ExamplePayslip = {
  externalId: string;
  formatPii: () => string;
  registration:
    | { schema: typeof AUSTRALIAN_PAYSLIP_V2_SCHEMA; payslipNonPii: AustralianPayslipV2 }
    | { schema: typeof NEW_ZEALAND_PAYSLIP_V2_SCHEMA; payslipNonPii: NewZealandPayslipV2 };
};

interface PreparedPayslip {
  payslip: ExamplePayslip;
  verifiablReference: string;
  issuedAt: string;
  encryptedPii: Uint8Array;
  encryptionMetadata: RegisterNonPiiRequest["encryptionMetadata"];
}

const PAYSLIPS: readonly ExamplePayslip[] = [
  {
    externalId: "PAY-1001",
    formatPii: () =>
      formatAustralianPii({
        employeeName: "Jane A. Doe",
        position: "Senior Developer",
        department: "Engineering",
        employerName: "Example Payroll Pty Ltd",
        employerAbn: "12 345 678 901",
        bsb: "062-000",
        accountNumber: "****5678",
        accountName: "Jane A Doe",
        address: {
          lines: ["12 Example St"],
          suburb: "Sydney",
          stateOrTerritory: "NSW",
          postcode: "2000",
        },
      }),
    registration: {
      schema: AUSTRALIAN_PAYSLIP_V2_SCHEMA,
      payslipNonPii: {
        // v2 permits a payslip with only the period end printed.
        periodEnd: "2026-08-31",
        paymentDate: "2026-09-04",
        currency: "AUD",
        gross: "9000.00",
        paygw: "2250.00",
        net: "6750.00",
      },
    },
  },
  {
    externalId: "PAY-1002",
    formatPii: () =>
      formatNewZealandPii({
        employeeName: "Zoë Nguyễn",
        irdNumber: "***-***-***",
        position: "Product Designer",
        department: "Product",
        employerName: "Example Payroll NZ Ltd",
        accountNumber: "**-****-*******-**",
        accountName: "Zoë Nguyễn",
        address: {
          lines: ["44 Harbour Rd"],
          suburb: "Parnell",
          city: "Auckland",
          postcode: "1052",
        },
      }),
    registration: {
      schema: NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
      payslipNonPii: {
        periodEnd: "2026-08-31",
        paymentDate: "2026-09-04",
        currency: "NZD",
        gross: "7600.00",
        paye: "1710.00",
        net: "5890.00",
      },
    },
  },
];

function readMode(value: string | undefined): Mode {
  if (value === "offline" || value === "live") return value;
  throw new Error("Usage: node dist/app.js <offline|live>");
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

function createLiveClient(): VerifiablClient {
  // snippet:start:node.self-managed.create-client
  const clientId = process.env.VERIFIABL_CLIENT_ID?.trim();
  const clientSecret = process.env.VERIFIABL_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Set VERIFIABL_CLIENT_ID and VERIFIABL_CLIENT_SECRET");
  }

  const client = new VerifiablClient({
    environment: "sandbox",
    auth: { clientId, clientSecret },
  });
  // snippet:end:node.self-managed.create-client
  return client;
}

function readLiveKey(): Buffer {
  const encoded = optionalEnvironment("VERIFIABL_ENCRYPTION_KEY_BASE64");
  if (encoded === undefined) {
    throw new Error("Live mode requires VERIFIABL_ENCRYPTION_KEY_BASE64");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("VERIFIABL_ENCRYPTION_KEY_BASE64 must be canonical base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("VERIFIABL_ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes");
  }
  return key;
}

function prepare(payslip: ExamplePayslip, key: Buffer): PreparedPayslip {
  // snippet:start:node.self-managed.format-and-encrypt
  const plaintext = payslip.formatPii();
  const { encryptedPii, encryptionMetadata } = encryptPii(plaintext, key);
  // snippet:end:node.self-managed.format-and-encrypt

  // snippet:start:node.self-managed.prepare-registration
  const verifiablReference = generateVerifiablReference();
  const issuedAt = new Date().toISOString();

  // Persist these values with the payslip before registration.
  // snippet:end:node.self-managed.prepare-registration
  return { payslip, verifiablReference, issuedAt, encryptedPii, encryptionMetadata };
}

async function writeArtifacts(
  outputRoot: string,
  group: "single" | "batch",
  prepared: PreparedPayslip,
  registration: "offline-only-unregistered" | "sandbox-registration-pending" | "sandbox-registered",
): Promise<void> {
  const { verifiablReference, encryptedPii } = prepared;
  // snippet:start:node.self-managed.build-qr
  const parts = { verifiablReference, encryptedPii };
  const badge = createBarcodeSvg(parts, { environment: "sandbox" });
  const svg = badge.svg;
  // snippet:end:node.self-managed.build-qr

  const scanUrl = buildScanUrl(parts, { environment: "sandbox" });

  // snippet:start:node.self-managed.build-xmp
  const xmpPayload = buildBarcodePayload({ verifiablReference, encryptedPii });
  // snippet:end:node.self-managed.build-xmp
  if (badge.content !== scanUrl || !scanUrl.includes("#2.") || !xmpPayload.startsWith("2|")) {
    throw new Error("Generated QR and XMP artifacts do not use the matching v2 contract");
  }

  const directory = resolve(outputRoot, group, prepared.payslip.externalId);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "badge.svg"), svg, "utf8"),
    writeFile(resolve(directory, "xmp-payload.txt"), `${xmpPayload}\n`, "utf8"),
    writeFile(
      resolve(directory, "manifest.json"),
      `${JSON.stringify(
        {
          externalId: prepared.payslip.externalId,
          verifiablReference: prepared.verifiablReference,
          environment: "sandbox",
          registration,
          registrationRequest: {
            kind: group,
            externalId: group === "batch" ? prepared.payslip.externalId : undefined,
            verifiablReference: prepared.verifiablReference,
            ...prepared.payslip.registration,
            issuedAt: prepared.issuedAt,
            encryptionMetadataEncoding: "base64",
            encryptionMetadata: {
              iv: Buffer.from(prepared.encryptionMetadata.iv).toString("base64"),
              tag: Buffer.from(prepared.encryptionMetadata.tag).toString("base64"),
            },
          },
          barcodeFormat: "v2",
          badge: "badge.svg",
          xmp: {
            payloadFile: "xmp-payload.txt",
            namespace: PDF_PAYLOAD_XMP_NAMESPACE,
            property: PDF_PAYLOAD_XMP_PROPERTY,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

async function run(): Promise<void> {
  const mode = readMode(process.argv[2]);
  const client = mode === "live" ? createLiveClient() : undefined;
  const key = mode === "offline" ? randomBytes(32) : readLiveKey();
  const outputBase = resolve(optionalEnvironment("VERIFIABL_EXAMPLE_OUTPUT_DIR") ?? "output");
  const outputRoot = resolve(
    outputBase,
    `run-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
  );

  const payslips = PAYSLIPS;
  const firstPayslip = payslips[0];
  if (firstPayslip === undefined) throw new Error("The example fixture is missing");
  const single = prepare(firstPayslip, key);
  const { payslip, verifiablReference, issuedAt, encryptionMetadata } = single;
  // snippet:start:node.self-managed.prepare-batch
  const batch = payslips.map((payslip) => {
    const plaintext = payslip.formatPii();
    const { encryptedPii, encryptionMetadata } = encryptPii(plaintext, key);

    const verifiablReference = generateVerifiablReference();
    const issuedAt = new Date().toISOString();

    // Persist these values with the payslip before registration.
    return { payslip, verifiablReference, issuedAt, encryptedPii, encryptionMetadata };
  });
  // snippet:end:node.self-managed.prepare-batch
  let batchOutcomes: Array<Record<string, string>>;
  let batchToWrite = batch;

  // Persist encrypted barcode payloads before network access so an artifact-write
  // failure cannot occur only after successful registration.
  const initialRegistration =
    mode === "live" ? "sandbox-registration-pending" : "offline-only-unregistered";
  await writeArtifacts(outputRoot, "single", single, initialRegistration);
  await Promise.all(
    batch.map((record) => writeArtifacts(outputRoot, "batch", record, initialRegistration)),
  );

  if (mode === "live") {
    if (client === undefined) throw new Error("Live client was not initialized");

    // snippet:start:node.self-managed.register-single
    await client.registerNonPii({
      verifiablReference,
      ...payslip.registration,
      issuedAt,
      encryptionMetadata,
    });
    // snippet:end:node.self-managed.register-single

    // snippet:start:node.self-managed.register-batch
    const response = await client.registerNonPiiBatch({
      records: batch.map((record) => ({
        verifiablReference: record.verifiablReference,
        externalId: record.payslip.externalId,
        ...record.payslip.registration,
        issuedAt: record.issuedAt,
        encryptionMetadata: record.encryptionMetadata,
      })),
    });

    const registeredOutcomes = response.results.map((result) => ({
      externalId: result.externalId ?? "unknown",
      verifiablReference: result.verifiablReference,
      status: result.status,
      ...(result.code === undefined ? {} : { code: result.code }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    }));
    // snippet:end:node.self-managed.register-batch
    batchOutcomes = registeredOutcomes;
    batchToWrite = batch.filter((_, index) => {
      const status = response.results[index]?.status;
      return status === "created" || status === "duplicate";
    });
  } else {
    batchOutcomes = batch.map((record) => ({
      externalId: record.payslip.externalId,
      verifiablReference: record.verifiablReference,
      status: "registration-skipped-offline",
    }));
  }

  if (mode === "live") {
    await writeArtifacts(outputRoot, "single", single, "sandbox-registered");
    await Promise.all(
      batchToWrite.map((record) =>
        writeArtifacts(outputRoot, "batch", record, "sandbox-registered"),
      ),
    );
  }
  await writeFile(
    resolve(outputRoot, "batch", "outcomes.json"),
    `${JSON.stringify(batchOutcomes, null, 2)}\n`,
    "utf8",
  );

  console.log(`${mode} issuer example completed`);
  if (mode === "offline") {
    console.log("Used an in-memory ephemeral key and made no network requests");
  }
  console.log(`Generated artifacts under ${outputRoot}`);
}

run().catch((error: unknown) => {
  console.error(
    `Issuer example failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
