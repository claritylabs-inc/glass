import { z } from "zod";

const nullableText = z.string().max(4_000).nullable();

const requirementSchema = z.object({
  kind: z.enum(["coverage", "insurer", "condition"]),
  scope: z.enum(["own_org", "vendors"]).nullable(),
  title: z.string().min(1).max(160),
  requirementText: z.string().min(1).max(4_000),
  lineOfBusiness: z.string().max(40).nullable(),
  limits: z
    .array(
      z.object({
        kind: z.string().min(1).max(80),
        amount: z.number().nonnegative(),
        label: z.string().max(160).nullable(),
      }),
    )
    .max(12)
    .nullable(),
  maxDeductible: z
    .object({
      amount: z.number().nonnegative(),
      label: z.string().max(160).nullable(),
    })
    .nullable(),
  coverageForm: z.enum(["occurrence", "claims_made"]).nullable(),
  retroactiveDateOnOrBefore: z.string().max(80).nullable(),
  provisions: z.array(z.string().min(1).max(120)).max(12).nullable(),
  requiredForms: z.array(z.string().min(1).max(80)).max(16).nullable(),
  minAmBestRating: nullableText,
  minAmBestFinancialSize: nullableText,
  admittedRequired: z.boolean().nullable(),
  conditionType: z
    .enum([
      "cancellation_notice",
      "certificate_delivery",
      "claims_reporting",
      "subcontractor_insurance",
      "other",
    ])
    .nullable(),
  noticeDays: z.number().int().nonnegative().nullable(),
  sourceExcerpt: z.string().min(1).max(2_000),
});

const specificationSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(2_000),
  sourceExcerpt: z.string().min(1).max(2_000),
});

export const procurementIntakeExtractionSchema = z.object({
  insuranceObligations: z.array(requirementSchema).max(40),
  placementSpecifications: z.array(specificationSchema).max(60),
});

export type ProcurementIntakeExtraction = z.infer<
  typeof procurementIntakeExtractionSchema
>;

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export function normalizeProcurementIntake(value: ProcurementIntakeExtraction) {
  const requirements = value.insuranceObligations.map((item) => ({
    proposedRequirement: {
      kind: item.kind,
      scope: item.scope ?? "own_org",
      title: item.title.trim(),
      requirementText: item.requirementText.trim(),
      lineOfBusiness: cleanOptional(item.lineOfBusiness)?.toUpperCase(),
      limits:
        item.limits?.map((limit) => ({
          kind: limit.kind.trim(),
          amount: limit.amount,
          label: cleanOptional(limit.label),
        })) ?? [],
      maxDeductible: item.maxDeductible
        ? {
            amount: item.maxDeductible.amount,
            label: cleanOptional(item.maxDeductible.label),
          }
        : undefined,
      coverageForm: item.coverageForm ?? undefined,
      retroactiveDateOnOrBefore: cleanOptional(item.retroactiveDateOnOrBefore),
      provisions: [
        ...new Set(
          (item.provisions ?? []).map((entry) => entry.trim()).filter(Boolean),
        ),
      ],
      requiredForms: [
        ...new Set(
          (item.requiredForms ?? [])
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ],
      minAmBestRating: cleanOptional(item.minAmBestRating),
      minAmBestFinancialSize: cleanOptional(item.minAmBestFinancialSize),
      admittedRequired: item.admittedRequired ?? undefined,
      conditionType: item.conditionType ?? undefined,
      noticeDays: item.noticeDays ?? undefined,
    },
    sourceExcerpt: item.sourceExcerpt.trim(),
  }));

  const specifications = value.placementSpecifications
    .map((item) => ({
      key: item.key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
      label: item.label.trim(),
      value: item.value.trim(),
      sourceExcerpt: item.sourceExcerpt.trim(),
    }))
    .filter((item) => item.key && item.label && item.value);

  return { requirements, specifications };
}
