import assert from "node:assert/strict";
import test from "node:test";
import {
  ClRouterConnectionError,
  ClRouterHttpError,
  ClRouterProtocolError,
  buildClRouterGenerateRequest,
  createClRouterClient,
  isClRouterTaskEnabled,
  parseClRouterTaskFlags,
  shouldFallBackFromClRouter,
} from "../src/clRouterClient.js";

const responseBody = {
  output: { policyNumber: "SYN-1" },
  usage: { inputTokens: 20, outputTokens: 4, cachedInputTokens: 2, cacheWriteTokens: 1 },
  costUsd: 0.00004,
  costStatus: "priced",
  model: { provider: "fireworks", model: "accounts/fireworks/models/deepseek-v3p2" },
  routing: {
    decision: "autonomous",
    candidatesConsidered: [
      { provider: "fireworks", model: "accounts/fireworks/models/deepseek-v3p2" },
    ],
    policyVersion: "policy-v1",
    cacheStickinessApplied: false,
    routeSource: "autonomous",
    attemptCount: 1,
    shadowMode: true,
    wouldHaveChosen: {
      provider: "openai",
      model: "gpt-5-mini",
      decision: "autonomous_primary",
    },
    wouldHaveMatched: false,
  },
  requestId: "router-request-1",
};

test("task flags support full extraction, preview, exact tasks, and wildcard", () => {
  const flags = parseClRouterTaskFlags(" extraction, extraction_preview ");
  assert.equal(isClRouterTaskEnabled(flags, "extraction", "extraction_focused"), true);
  assert.equal(isClRouterTaskEnabled(flags, "classification", "extraction_classify"), true);
  assert.equal(isClRouterTaskEnabled(flags, "extraction_preview", "extraction_preview"), true);
  assert.equal(isClRouterTaskEnabled(parseClRouterTaskFlags("classification"), "classification"), true);
  assert.equal(isClRouterTaskEnabled(parseClRouterTaskFlags("*"), "summary"), true);
  assert.equal(isClRouterTaskEnabled(parseClRouterTaskFlags(""), "extraction"), false);
});

test("request builder forwards schema, snapshot, and base64 assets without mutation", () => {
  const schema = { type: "object", properties: { policyNumber: { type: "string" } } };
  const settings = {
    routes: { extraction: { provider: "openai", model: "gpt-5.4-mini" } },
    routeSources: { extraction: "broker" },
    providerKeys: { openai: "broker-secret" },
  };
  const request = buildClRouterGenerateRequest({
    task: "extraction",
    taskKind: "extraction_focused",
    tenantId: "glass",
    orgId: "org-1",
    settings,
    prompt: "Extract the policy.",
    schema,
    maxTokens: 4096,
    assets: {
      pdfBytes: Uint8Array.from([1, 2, 3]),
      images: [{ imageBase64: "image-data", mimeType: "image/png" }],
    },
  });
  assert.deepEqual(request.settings, settings);
  assert.deepEqual(request.schema, schema);
  assert.equal(request.prompt, undefined);
  assert.equal(request.messages?.[0]?.content[0]?.type, "image");
  assert.deepEqual(request.messages?.[0]?.content[1], {
    type: "file",
    data: "AQID",
    mediaType: "application/pdf",
    filename: "document.pdf",
  });
});

test("client authenticates and preserves actual routing, request, usage, and cost metadata", async () => {
  let request: RequestInit | undefined;
  const client = createClRouterClient({
    baseUrl: "https://router.internal/",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async (_input, init) => {
      request = init;
      return Response.json(responseBody);
    },
  });
  const result = await client.generate({
    task: "extraction_preview",
    tenantId: "glass",
    prompt: "Extract preview.",
    schema: { type: "object" },
  });
  assert.equal(new Headers(request?.headers).get("authorization"), "Bearer shared-secret");
  assert.equal(result.requestId, "router-request-1");
  assert.equal(result.model.provider, "fireworks");
  assert.equal(result.routing.policyVersion, "policy-v1");
  assert.deepEqual(result.routing.wouldHaveChosen, {
    provider: "openai",
    model: "gpt-5-mini",
    decision: "autonomous_primary",
  });
  assert.equal(result.routing.shadowMode, true);
  assert.equal(result.routing.wouldHaveMatched, false);
  assert.equal(result.costUsd, 0.00004);
  assert.equal(result.usage.cachedInputTokens, 2);
  assert.equal(result.usage.cacheWriteTokens, 1);
});

test("client permits plaintext only for loopback hosts", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const client = createClRouterClient({
      baseUrl: `http://${host}:3000`,
      secret: "shared-secret",
      timeoutMs: 1000,
      fetch: async () => Response.json(responseBody),
    });
    await client.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "Extract.",
      schema: { type: "object" },
    });
  }

  assert.throws(
    () => createClRouterClient({
      baseUrl: "http://router.internal",
      secret: "shared-secret",
      timeoutMs: 1000,
    }),
    /must use HTTPS/,
  );
});

test("only connection, timeout, and 5xx failures permit direct-provider fallback", () => {
  assert.equal(
    shouldFallBackFromClRouter(new ClRouterConnectionError("connection", new Error("offline"))),
    true,
  );
  assert.equal(shouldFallBackFromClRouter(new ClRouterHttpError(503, "Unavailable")), true);
  assert.equal(shouldFallBackFromClRouter(new ClRouterHttpError(400, "Bad Request")), false);
  assert.equal(shouldFallBackFromClRouter(new ClRouterProtocolError("invalid")), false);
});

test("client classifies fetch rejection and timeout as safe connection failures", async () => {
  const disconnected = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => { throw new TypeError("fetch failed"); },
  });
  await assert.rejects(
    disconnected.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    (error) => error instanceof ClRouterConnectionError
      && error.kind === "connection"
      && shouldFallBackFromClRouter(error),
  );

  const timedOut = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 5,
    fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  await assert.rejects(
    timedOut.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    (error) => error instanceof ClRouterConnectionError
      && error.kind === "timeout"
      && shouldFallBackFromClRouter(error),
  );
});

test("invalid 2xx responses fail closed", async () => {
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => Response.json({ output: {} }),
  });
  await assert.rejects(
    client.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    ClRouterProtocolError,
  );
});
