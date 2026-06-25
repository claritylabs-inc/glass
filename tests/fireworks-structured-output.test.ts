import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  InsuranceDocumentSchema,
  PceSubmissionPacketSchema,
  PolicyOperationalProfileSchema,
} from "@claritylabs/cl-sdk";
import {
  collectFireworksSchemaIssues,
  normalizeJsonSchemaForFireworks,
  structuredOutputSchemaForRoute,
} from "../convex/lib/fireworksStructuredOutput";

const SDK_STRUCTURED_OUTPUT_SCHEMAS = [
  ["InsuranceDocumentSchema", InsuranceDocumentSchema],
  ["PolicyOperationalProfileSchema", PolicyOperationalProfileSchema],
  ["PceSubmissionPacketSchema", PceSubmissionPacketSchema],
] as const;

describe("Fireworks structured output schema adapter", () => {
  test.each(SDK_STRUCTURED_OUTPUT_SCHEMAS)(
    "normalizes %s to the Fireworks JSON Schema subset",
    (_name, schema) => {
      const rawJsonSchema = z.toJSONSchema(schema);
      const rawIssues = collectFireworksSchemaIssues(rawJsonSchema);
      expect(rawIssues.length).toBeGreaterThan(0);

      const normalized = normalizeJsonSchemaForFireworks(rawJsonSchema);
      expect(collectFireworksSchemaIssues(normalized)).toEqual([]);
    },
  );

  test("keeps original Zod validation even after relaxing the provider schema", async () => {
    const schema = z.object({
      name: z.string().min(3),
      tags: z.array(z.string()).max(2),
    });
    const adapted = structuredOutputSchemaForRoute(schema, {
      provider: "fireworks",
    });
    const adaptedSchema = adapted as {
      jsonSchema: unknown;
      validate?: (value: unknown) => Promise<unknown> | unknown;
    };

    expect(collectFireworksSchemaIssues(adaptedSchema.jsonSchema)).toEqual([]);
    expect(await adaptedSchema.validate?.({ name: "ok", tags: ["a", "b", "c"] })).toMatchObject({
      success: false,
    });
    expect(await adaptedSchema.validate?.({ name: "okay", tags: ["a"] })).toEqual({
      success: true,
      value: { name: "okay", tags: ["a"] },
    });
  });

  test("removes nullable enums that Fireworks rejects", () => {
    const schema = {
      type: "object",
      properties: {
        documentType: { type: ["string", "null"], enum: ["policy", "quote", null] },
      },
    };

    expect(collectFireworksSchemaIssues(schema)).toContain("$.properties.documentType.enum:null");

    const normalized = normalizeJsonSchemaForFireworks(schema) as {
      properties: { documentType: Record<string, unknown> };
    };
    expect(normalized.properties.documentType).toEqual({ type: ["string", "null"] });
    expect(collectFireworksSchemaIssues(normalized)).toEqual([]);
  });
});
