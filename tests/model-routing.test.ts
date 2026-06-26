import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";

import {
  FALLBACK_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  fallbackRouteForCall,
  modelTaskForCall,
  primaryRouteForCall,
} from "../convex/lib/models";
import {
  EXTRACTION_QUALITY_MODEL,
  LANGUAGE_MODEL_CATALOG,
  MODEL_DISPLAY_NAMES,
  MODEL_TASK_GROUPS,
  OPERATOR_MODEL_ROUTE_GROUPS,
  isRetiredModelRoute,
} from "../convex/lib/modelCatalog";

describe("model task routing", () => {
  test("routes the main web chat assistant to Fireworks DeepSeek Flash", () => {
    expect(MODEL_ROUTING.chat).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
    });
  });

  test("keeps the Fireworks default model set constrained by use case", () => {
    for (const task of [
      "email_draft",
      "email_reply",
      "analysis",
      "summary",
      "mailbox_coordinator",
      "application_authoring",
    ] as const) {
      expect(MODEL_ROUTING[task]).toEqual({
        provider: "fireworks",
        model: FIREWORKS_MODEL_IDS.glm52,
      });
    }

    for (const task of [
      "classification",
      "extraction",
      "extraction_preview",
      "triage",
      "email_extraction",
      "document_extraction",
    ] as const) {
      expect(MODEL_ROUTING[task]).toEqual({
        provider: "fireworks",
        model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
      });
    }

    expect(MODEL_ROUTING.chat).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
    });
  });

  test("removes Kimi from active routing and catalog selection", () => {
    expect(LANGUAGE_MODEL_CATALOG.fireworks).toContain(
      FIREWORKS_MODEL_IDS.deepseekV4Pro,
    );
    expect(MODEL_DISPLAY_NAMES[FIREWORKS_MODEL_IDS.deepseekV4Pro]).toBe(
      "DeepSeek V4 Pro",
    );
    expect(LANGUAGE_MODEL_CATALOG.fireworks).not.toContain(
      "accounts/fireworks/models/kimi-k2p6",
    );
    expect(LANGUAGE_MODEL_CATALOG.fireworks).not.toContain(
      "accounts/fireworks/routers/kimi-k2p6-fast",
    );
    expect(isRetiredModelRoute({
      provider: "fireworks",
      model: "accounts/fireworks/models/kimi-k2p6",
    })).toBe(true);
    expect(isRetiredModelRoute(MODEL_ROUTING.extraction)).toBe(false);
  });

  test("keeps embeddings on the OpenAI-compatible 1536-dimensional route during migration", () => {
    expect(MODEL_ROUTING.embeddings).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
    });
  });

  test("uses cl-sdk taskKind structure to select the host task", () => {
    expect(modelTaskForCall("extraction", "extraction_classify")).toBe("classification");
    expect(modelTaskForCall("extraction", "extraction_long_list")).toBe("extraction");
    expect(modelTaskForCall("chat", "query_reason")).toBe("chat");
    expect(modelTaskForCall("extraction", "application_extract_fields")).toBe(
      "application_authoring",
    );
    expect(modelTaskForCall("extraction", "pce_impact_analysis")).toBe("analysis");
  });

  test("keeps root app and extraction worker on the same cl-sdk version", () => {
    const appPackage = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
    const workerPackage = JSON.parse(
      readFileSync(join(__dirname, "../extraction-worker/package.json"), "utf-8"),
    );

    expect(appPackage.scripts["check:cl-sdk-version"]).toContain("check-cl-sdk-version");
    expect(workerPackage.scripts.prebuild).toContain("check-cl-sdk-version");
    expect(appPackage.dependencies["@claritylabs/cl-sdk"]).toBe(
      workerPackage.dependencies["@claritylabs/cl-sdk"],
    );
  });

  test("keeps SDK extraction review broad pass disabled in Glass hosts", () => {
    const appExtractor = readFileSync(join(__dirname, "../convex/lib/extraction.ts"), "utf-8");
    const worker = readFileSync(join(__dirname, "../extraction-worker/src/index.ts"), "utf-8");

    expect(appExtractor).toContain('readReviewModeEnv("EXTRACTION_REVIEW_MODE", "skip")');
    expect(worker).toContain('readReviewModeEnv("EXTRACTION_REVIEW_MODE", "skip")');
    expect(worker).toContain("modelCapabilitiesForRoute(route.model)");
    expect(worker).not.toContain("EXTRACTION_MAX_TOKEN_OVERRIDES");
  });
});

describe("thread chat streaming reliability", () => {
  test("retries transient provider stream errors before tool side effects", () => {
    const source = readFileSync(
      join(__dirname, "../convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(source).toContain("isTransientChatStreamError");
    expect(source).toContain('part.type === "error"');
    expect(source).toContain("hasStartedSideEffectfulWork");
    expect(source).toContain("resetStreamStateForRetry");
    expect(source).toContain("fallbackRouteForCall({");
    expect(source).toContain("Retrying chat stream after transient provider error");
  });

  test("keeps heavy mailbox tools behind the coordinator in web chat", () => {
    const source = readFileSync(
      join(__dirname, "../convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(source).toContain("coordinate_mailbox_task");
    expect(source).not.toContain("search_connected_email:");
    expect(source).not.toContain("read_connected_email_attachment:");
    expect(source).not.toContain("import_connected_email_policy_attachments:");
  });
});

describe("model fallback policy", () => {
  test("uses Fireworks DeepSeek V4 Pro as the default fallback provider", () => {
    expect(FALLBACK_MODEL).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.deepseekV4Pro,
    });
  });

  test("does not generically escalate cheap extraction or classification calls", () => {
    expect(fallbackRouteForCall({ task: "extraction" })).toBeNull();
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_focused" })).toBeNull();
    expect(fallbackRouteForCall({ task: "classification" })).toBeNull();
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_classify" })).toBeNull();
  });

  test("allows intentional quality escalation for task kinds that warrant it", () => {
    expect(
      fallbackRouteForCall({ task: "extraction", taskKind: "extraction_source_tree" }),
    ).toEqual(FALLBACK_MODEL);
    expect(
      fallbackRouteForCall({ task: "extraction", taskKind: "extraction_operational_profile" }),
    ).toEqual(FALLBACK_MODEL);
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_review" })).toEqual(
      FALLBACK_MODEL,
    );
    expect(
      fallbackRouteForCall({ task: "extraction", taskKind: "extraction_referential_lookup" }),
    ).toEqual(FALLBACK_MODEL);
    expect(
      fallbackRouteForCall({
        task: "analysis",
        taskKind: "pce_packet_generation",
        primaryRoute: {
          provider: "fireworks",
          model: FIREWORKS_MODEL_IDS.glm52,
        },
      }),
    ).toEqual(FALLBACK_MODEL);
  });

  test("uses the configured fallback route for retries", () => {
    const fallbackRoute = {
      provider: "fireworks" as const,
      model: FIREWORKS_MODEL_IDS.glm52,
    };

    expect(
      fallbackRouteForCall({
        task: "extraction",
        taskKind: "extraction_review",
        primaryRoute: MODEL_ROUTING.extraction,
        fallbackRoute,
      }),
    ).toEqual(fallbackRoute);
  });

  test("honors explicit no-fallback contexts for optional repair calls", () => {
    expect(
      fallbackRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        allowFallback: false,
      }),
    ).toBeNull();
  });

  test("uses the configured quality route for proactive extraction", () => {
    const qualityRoute = {
      provider: "fireworks" as const,
      model: FIREWORKS_MODEL_IDS.glm52,
    };

    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        primaryRoute: MODEL_ROUTING.extraction,
        qualityRoute,
      }),
    ).toEqual(qualityRoute);
  });

  test("starts source-tree and operational-profile extraction on the quality route", () => {
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        primaryRoute: MODEL_ROUTING.extraction,
      }),
    ).toEqual(EXTRACTION_QUALITY_MODEL);
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_operational_profile",
        primaryRoute: MODEL_ROUTING.extraction,
      }),
    ).toEqual(EXTRACTION_QUALITY_MODEL);
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_focused",
        primaryRoute: MODEL_ROUTING.extraction,
      }),
    ).toBeNull();
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        primaryRoute: EXTRACTION_QUALITY_MODEL,
      }),
    ).toEqual(EXTRACTION_QUALITY_MODEL);
  });

  test("does not retry when the selected route is already the fallback route", () => {
    expect(
      fallbackRouteForCall({
        task: "chat",
        taskKind: "query_reason",
        primaryRoute: FALLBACK_MODEL,
      }),
    ).toBeNull();
  });

  test("exposes separate quality and fallback routes in operator model settings", () => {
    const modelCatalog = readFileSync(
      join(__dirname, "../convex/lib/modelCatalog.ts"),
      "utf-8",
    );
    const operatorModelsPage = readFileSync(
      join(__dirname, "../app/operator/models/page.tsx"),
      "utf-8",
    );

    expect(modelCatalog).toContain(
      'EXTRACTION_QUALITY_MODEL_ROUTE_ID = "extraction_quality"',
    );
    expect(modelCatalog).toContain(
      'EXTRACTION_FORM_INVENTORY_MODEL_ROUTE_ID =\n  "extraction_form_inventory"',
    );
    expect(modelCatalog).toContain('FALLBACK_MODEL_ROUTE_ID = "fallback"');
    expect(modelCatalog).toContain("Source tree and profile extraction");
    expect(modelCatalog).toContain("Form inventory");
    expect(modelCatalog).toContain("Fallback model");
    expect(OPERATOR_MODEL_ROUTE_GROUPS.flatMap((group) => group.tasks)).toContain(
      "extraction_quality",
    );
    expect(OPERATOR_MODEL_ROUTE_GROUPS.flatMap((group) => group.tasks)).toContain(
      "extraction_form_inventory",
    );
    expect(OPERATOR_MODEL_ROUTE_GROUPS.flatMap((group) => group.tasks)).toContain(
      "fallback",
    );
    expect(MODEL_TASK_GROUPS.flatMap((group) => group.tasks)).not.toContain(
      "extraction_quality",
    );
    expect(operatorModelsPage).toContain("settings.groups.map");
    expect(operatorModelsPage).not.toContain("const TASK_GROUPS");
  });

  test("applies operator global routes even when an org has no broker settings", () => {
    const settingsSource = readFileSync(join(__dirname, "../convex/modelSettings.ts"), "utf-8");

    expect(settingsSource).not.toContain("if (!brokerOrgId) return null");
    expect(settingsSource).toContain("const settings = brokerOrgId");
    expect(settingsSource).toContain('routeSources[routeId] = "global"');
  });
});

describe("mailbox coordinator routing", () => {
  test("uses the high-quality Fireworks reasoning route for complex mailbox workflows", () => {
    expect(MODEL_ROUTING.mailbox_coordinator).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.glm52,
    });
  });
});

describe("web retrieval routing", () => {
  test("defaults public web retrieval to Exa", () => {
    expect(WEB_RETRIEVAL_DEFAULT).toEqual({ primary: "exa" });
  });

  test("keeps native browsing default routes aligned with their providers", () => {
    expect(WEB_RETRIEVAL_DEFAULT_ROUTES.openai.provider).toBe("openai");
    expect(WEB_RETRIEVAL_DEFAULT_ROUTES.google.provider).toBe("google");
    expect(WEB_RETRIEVAL_DEFAULT_ROUTES.anthropic.provider).toBe("anthropic");
    expect(WEB_RETRIEVAL_DEFAULT_ROUTES.xai.provider).toBe("xai");
  });

  test("wires web research into all agent channels", () => {
    const files = [
      "../convex/actions/processThreadChat.ts",
      "../convex/actions/mcpChat.ts",
      "../convex/actions/handleInboundEmail.ts",
      "../convex/actions/handleInboundImessage.ts",
    ];

    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf-8");
      expect(source).toContain("web_research");
      expect(source).toContain("runWebRetrieval");
    }
  });

  test("routes website enrichment through the shared web retrieval layer", () => {
    const source = readFileSync(
      join(__dirname, "../convex/actions/extractCompanyInfo.ts"),
      "utf-8",
    );

    expect(source).toContain("runWebRetrieval");
    expect(source).not.toContain("api.exa.ai/contents");
    expect(source).not.toContain('livecrawl: "always"');
  });

  test("allows Gemini and Grok web retrieval through Vercel AI Gateway", () => {
    const retrievalSource = readFileSync(
      join(__dirname, "../convex/lib/webRetrieval.ts"),
      "utf-8",
    );
    const settingsSource = readFileSync(join(__dirname, "../convex/modelSettings.ts"), "utf-8");

    expect(retrievalSource).toContain("AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN");
    expect(retrievalSource).toContain("gateway(gatewayModelId(route))");
    expect(settingsSource).toContain("AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN");
    expect(settingsSource).toContain("|| hasGatewayAccess");
  });
});
