import { v } from "convex/values";

export const sourceBackedProductValueValidator = v.object({
  value: v.string(),
  normalizedValue: v.optional(v.string()),
  confidence: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
  sourceNodeIds: v.array(v.string()),
  sourceSpanIds: v.array(v.string()),
});

export const policyProductIdentityValidator = v.object({
  name: v.optional(sourceBackedProductValueValidator),
  companyProductCode: v.optional(sourceBackedProductValueValidator),
  companyProductSubCode: v.optional(sourceBackedProductValueValidator),
});

export type SourceBackedProductValue = {
  value: string;
  normalizedValue?: string;
  confidence: "low" | "medium" | "high";
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

export type PolicyProductIdentity = {
  name?: SourceBackedProductValue;
  companyProductCode?: SourceBackedProductValue;
  companyProductSubCode?: SourceBackedProductValue;
};

function readSourceBackedProductValue(
  value: unknown,
): SourceBackedProductValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const text = typeof record.value === "string" ? record.value.trim() : "";
  if (!text) return undefined;
  const confidence = record.confidence;
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    return undefined;
  }
  return {
    value: text,
    ...(typeof record.normalizedValue === "string" && record.normalizedValue.trim()
      ? { normalizedValue: record.normalizedValue.trim() }
      : {}),
    confidence,
    sourceNodeIds: Array.isArray(record.sourceNodeIds)
      ? record.sourceNodeIds.filter((id): id is string => typeof id === "string")
      : [],
    sourceSpanIds: Array.isArray(record.sourceSpanIds)
      ? record.sourceSpanIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export function readPolicyProductIdentity(
  value: unknown,
): PolicyProductIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const identity = {
    name: readSourceBackedProductValue(record.name),
    companyProductCode: readSourceBackedProductValue(record.companyProductCode),
    companyProductSubCode: readSourceBackedProductValue(
      record.companyProductSubCode,
    ),
  };
  return identity.name ||
    identity.companyProductCode ||
    identity.companyProductSubCode
    ? identity
    : undefined;
}

export function policyProductName(policy: {
  productIdentity?: unknown;
  programName?: unknown;
}): string | undefined {
  const sourceBackedName = readPolicyProductIdentity(
    policy.productIdentity,
  )?.name?.value;
  if (sourceBackedName) return sourceBackedName;
  return typeof policy.programName === "string" && policy.programName.trim()
    ? policy.programName.trim()
    : undefined;
}
