import { z } from "zod";
import {
  australianAllowanceTypes,
  australianDeductionTypes,
  australianEarningsTypes,
  australianEmploymentBases,
  australianEngagementTypes,
  australianOtherAllowanceCategories,
  australianPaidLeaveTypes,
  australianPayFrequencies,
  australianSalarySacrificeTypes,
  australianSuperContributionTypes,
  newZealandAllowanceTypes,
  newZealandDeductionTypes,
  newZealandEarningsTypes,
  newZealandLeaveBalanceUnits,
  newZealandPaidLeaveTypes,
} from "../index.js";
import { australianPayslipV2Schema, newZealandPayslipV2Schema } from "../payslipV2.js";

type JsonShape = {
  properties?: Record<string, JsonShape>;
  items?: JsonShape;
  oneOf?: JsonShape[];
  anyOf?: JsonShape[];
  enum?: string[];
  const?: string;
};

function codeSets(schema: JsonShape): string[][] {
  return [
    ...(schema.enum ? [schema.enum] : []),
    ...Object.values(schema.properties ?? {}).flatMap(codeSets),
    ...(schema.items ? codeSets(schema.items) : []),
    ...(schema.oneOf ?? []).flatMap(codeSets),
    ...(schema.anyOf ?? []).flatMap(codeSets),
  ];
}

function earningsDiscriminators(schema: JsonShape): string[] {
  const options = schema.properties?.earnings?.items?.oneOf;
  if (!options) throw new Error("Missing earnings union in schema");
  return options.map((option) => {
    const value = option.properties?.type?.const;
    if (!value) throw new Error("Missing earnings discriminator");
    return value;
  });
}

const auSchema = z.toJSONSchema(australianPayslipV2Schema, { io: "output" }) as JsonShape;
const nzSchema = z.toJSONSchema(newZealandPayslipV2Schema, { io: "output" }) as JsonShape;

it("exports complete runtime code lists from the public entry point", () => {
  for (const [schema, lists] of [
    [
      auSchema,
      [
        australianPaidLeaveTypes,
        australianAllowanceTypes,
        australianOtherAllowanceCategories,
        australianDeductionTypes,
        australianSalarySacrificeTypes,
        australianSuperContributionTypes,
        australianPayFrequencies,
        australianEmploymentBases,
        australianEngagementTypes,
      ],
    ],
    [
      nzSchema,
      [
        newZealandPaidLeaveTypes,
        newZealandAllowanceTypes,
        newZealandDeductionTypes,
        newZealandLeaveBalanceUnits,
      ],
    ],
  ] as const) {
    const sets = codeSets(schema);
    for (const list of lists) {
      expect(sets).toContainEqual([...list]);
      expect(new Set(list).size).toBe(list.length);
    }
  }
  expect(australianEarningsTypes).toEqual(earningsDiscriminators(auSchema));
  expect(newZealandEarningsTypes).toEqual(earningsDiscriminators(nzSchema));
});
