#!/usr/bin/env node

import { existsSync } from "fs";
import dayjs from "dayjs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  InsuranceDocumentSchema,
  PceSubmissionPacketSchema,
  PolicyOperationalProfileSchema,
} from "@claritylabs/cl-sdk";

const unsupportedSchemaKeys = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "patternProperties",
  "propertyNames",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonSchemaForFireworks(schema) {
  if (Array.isArray(schema)) return schema.map((item) => normalizeJsonSchemaForFireworks(item));
  if (!isRecord(schema)) return schema;

  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (unsupportedSchemaKeys.has(key)) continue;
    if (key === "oneOf") {
      const replacement = normalizeJsonSchemaForFireworks(value);
      normalized.anyOf = Array.isArray(normalized.anyOf) && Array.isArray(replacement)
        ? [...normalized.anyOf, ...replacement]
        : replacement;
      continue;
    }
    normalized[key] = normalizeJsonSchemaForFireworks(value);
  }
  return normalized;
}

function collectFireworksSchemaIssues(schema, path = "$") {
  const issues = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => {
      issues.push(...collectFireworksSchemaIssues(item, `${path}[${index}]`));
    });
    return issues;
  }
  if (!isRecord(schema)) return issues;

  for (const [key, value] of Object.entries(schema)) {
    if (unsupportedSchemaKeys.has(key) || key === "oneOf") {
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

function providerSchemaFromZod(schema) {
  const rawJsonSchema = z.toJSONSchema(schema);
  const normalizedJsonSchema = normalizeJsonSchemaForFireworks(rawJsonSchema);
  return jsonSchema(normalizedJsonSchema, {
    validate: (value) => {
      const parsed = schema.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  });
}

const sdkSchemas = [
  ["InsuranceDocumentSchema", InsuranceDocumentSchema],
  ["PolicyOperationalProfileSchema", PolicyOperationalProfileSchema],
  ["PceSubmissionPacketSchema", PceSubmissionPacketSchema],
];
const FIREWORKS_REASONING_MODEL = "accounts/fireworks/models/glm-5p2";
const FIREWORKS_CHAT_MODEL = "accounts/fireworks/routers/kimi-k2p6-fast";
const FIREWORKS_EXTRACTION_MODEL = "accounts/fireworks/models/kimi-k2p6";
const RED_SQUARE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAfElEQVR4nNXOQREAMAjAsK7+PTMRPLhGQd7QJnESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ES53Vg6wNShQF/fRSLfgAAAABJRU5ErkJggg==";

for (const envFile of [".env.local", ".env.development.local", "extraction-worker/.env"]) {
  if (process.env.FIREWORKS_API_KEY || typeof process.loadEnvFile !== "function") break;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

const staticChecks = sdkSchemas.map(([name, schema]) => {
  const rawJsonSchema = z.toJSONSchema(schema);
  const rawIssues = collectFireworksSchemaIssues(rawJsonSchema);
  const normalizedIssues = collectFireworksSchemaIssues(
    normalizeJsonSchemaForFireworks(rawJsonSchema),
  );
  return {
    name,
    rawIssueCount: rawIssues.length,
    normalizedIssueCount: normalizedIssues.length,
    sampleRawIssues: rawIssues.slice(0, 8),
  };
});

const result = {
  ranAt: dayjs().toISOString(),
  staticChecks,
  liveFireworks: {
    skipped: !process.env.FIREWORKS_API_KEY,
    reasoningModel: FIREWORKS_REASONING_MODEL,
    chatModel: FIREWORKS_CHAT_MODEL,
    extractionModel: FIREWORKS_EXTRACTION_MODEL,
  },
};

if (staticChecks.some((check) => check.normalizedIssueCount > 0)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

if (process.env.FIREWORKS_API_KEY) {
  const smokeSchema = z.object({
    task: z.string().min(1).max(40),
    canRun: z.boolean(),
    confidence: z.number().min(0).max(1),
    checks: z.array(z.string().min(1).max(80)).min(1).max(4),
  });
  const fireworks = createOpenAICompatible({
    name: "fireworks",
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKey: process.env.FIREWORKS_API_KEY,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });
  const structuredSmoke = await generateText({
    model: fireworks(FIREWORKS_REASONING_MODEL),
    output: Output.object({ schema: providerSchemaFromZod(smokeSchema) }),
    maxOutputTokens: 256,
    prompt:
      "Return only JSON for a migration parity harness. Use task='structured_output_smoke', canRun=true, confidence=0.95, and checks=['schema_normalized','json_valid'].",
  });
  let structuredOutput;
  try {
    structuredOutput = structuredSmoke.output;
  } catch (error) {
    throw new Error(`${FIREWORKS_REASONING_MODEL} did not return parsed structured output`, {
      cause: error,
    });
  }
  const visionSmoke = await generateText({
    model: fireworks(FIREWORKS_EXTRACTION_MODEL),
    maxOutputTokens: 128,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Answer with one lowercase word: what is the dominant color in this image?",
          },
          {
            type: "image",
            image: RED_SQUARE_PNG_BASE64,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });
  if (!/\bred\b/i.test(visionSmoke.text)) {
    throw new Error(`${FIREWORKS_EXTRACTION_MODEL} did not identify the red image`);
  }
  const toolSmoke = await generateText({
    model: fireworks(FIREWORKS_CHAT_MODEL),
    maxOutputTokens: 128,
    tools: {
      lookup_status: tool({
        description: "Look up the status for a policy ID.",
        inputSchema: z.object({
          policyId: z.string().min(1),
        }),
        execute: async ({ policyId }) => ({ policyId, status: "active" }),
      }),
    },
    toolChoice: { type: "tool", toolName: "lookup_status" },
    stopWhen: stepCountIs(1),
    prompt: "Call lookup_status for policyId POL-123.",
  });
  const toolCallCount =
    toolSmoke.toolCalls?.length ??
    toolSmoke.steps?.reduce((count, step) => count + (step.toolCalls?.length ?? 0), 0) ??
    0;
  if (toolCallCount === 0) {
    throw new Error(`${FIREWORKS_CHAT_MODEL} did not emit the forced tool call`);
  }
  result.liveFireworks = {
    skipped: false,
    reasoningModel: FIREWORKS_REASONING_MODEL,
    chatModel: FIREWORKS_CHAT_MODEL,
    extractionModel: FIREWORKS_EXTRACTION_MODEL,
    structuredOutput,
    structuredUsage: structuredSmoke.usage,
    visionOutput: visionSmoke.text,
    visionUsage: visionSmoke.usage,
    toolOutput: toolSmoke.text,
    toolCallCount,
    toolUsage: toolSmoke.usage,
  };
}

console.log(JSON.stringify(result, null, 2));
