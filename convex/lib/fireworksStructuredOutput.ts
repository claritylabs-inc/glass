"use node";

import { jsonSchema, type FlexibleSchema } from "ai";
import type { ValidationResult } from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { ModelRoute } from "./modelCatalog";

const FIREWORKS_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "patternProperties",
  "propertyNames",
]);

type JsonSchemaNode = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoExternalRefs(schema: unknown, path = "$") {
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => assertNoExternalRefs(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(schema)) return;
  const ref = schema.$ref;
  if (typeof ref === "string" && !ref.startsWith("#/")) {
    throw new Error(`Fireworks structured output does not support external JSON Schema refs at ${path}`);
  }
  for (const [key, value] of Object.entries(schema)) {
    assertNoExternalRefs(value, `${path}.${key}`);
  }
}

export function normalizeJsonSchemaForFireworks(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((item) => normalizeJsonSchemaForFireworks(item));
  if (!isRecord(schema)) return schema;

  const normalized: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(schema)) {
    if (FIREWORKS_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "oneOf") {
      const replacement = normalizeJsonSchemaForFireworks(value);
      normalized.anyOf =
        Array.isArray(normalized.anyOf) && Array.isArray(replacement)
          ? [...normalized.anyOf, ...replacement]
          : replacement;
      continue;
    }
    normalized[key] = normalizeJsonSchemaForFireworks(value);
  }
  return normalized;
}

function zodValidationResult<T>(schema: z.ZodType<T>, value: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { success: true, value: parsed.data };
  return { success: false, error: parsed.error };
}

export function structuredOutputSchemaForRoute<T>(
  schema: z.ZodType<T>,
  route?: Pick<ModelRoute, "provider"> | null,
): FlexibleSchema<T> {
  if (route?.provider !== "fireworks") return schema;

  const rawJsonSchema = z.toJSONSchema(schema);
  assertNoExternalRefs(rawJsonSchema);
  const fireworksSchema = normalizeJsonSchemaForFireworks(rawJsonSchema);
  return jsonSchema<T>(fireworksSchema as Parameters<typeof jsonSchema<T>>[0], {
    validate: (value) => zodValidationResult(schema, value),
  });
}

export function collectFireworksSchemaIssues(schema: unknown, path = "$"): string[] {
  const issues: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => {
      issues.push(...collectFireworksSchemaIssues(item, `${path}[${index}]`));
    });
    return issues;
  }
  if (!isRecord(schema)) return issues;

  for (const [key, value] of Object.entries(schema)) {
    if (FIREWORKS_UNSUPPORTED_SCHEMA_KEYS.has(key) || key === "oneOf") {
      issues.push(`${path}.${key}`);
    }
    if (key === "$ref" && typeof value === "string" && !value.startsWith("#/")) {
      issues.push(`${path}.$ref:${value}`);
    } else {
      issues.push(...collectFireworksSchemaIssues(value, `${path}.${key}`));
    }
  }
  return issues;
}
