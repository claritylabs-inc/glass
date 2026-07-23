export type ClRouterModelRoute = {
  provider: string;
  model: string;
};

export type ClRouterSettingsSnapshot = {
  routes?: Record<string, ClRouterModelRoute | undefined>;
  routeSources?: Record<string, string | undefined>;
  providerKeys?: Record<string, string | undefined>;
};

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "file"; data: string; mediaType: string; filename?: string };

export type ClRouterMessage = {
  role: "user";
  content: ClRouterMessagePart[];
};

export type ClRouterProviderAssets = {
  pdfBase64?: string;
  pdfBytes?: Uint8Array;
  mimeType?: string;
  images?: Array<{ imageBase64: string; mimeType?: string }>;
};

export type ClRouterGenerateRequest = {
  task: string;
  taskKind?: string;
  tenantId: string;
  orgId?: string;
  settings?: ClRouterSettingsSnapshot;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  sessionKey?: string;
  routing?: { pin?: ClRouterModelRoute; allowFallback?: boolean };
  trace?: Record<string, unknown>;
};

export type ClRouterRoutingMetadata = {
  decision: string;
  candidatesConsidered: ClRouterModelRoute[];
  policyVersion: string | null;
  cacheStickinessApplied: boolean;
  routeSource?: string;
  attemptCount: number;
  shadowMode?: boolean;
  wouldHaveChosen?: ClRouterModelRoute & { decision: string };
  wouldHaveMatched?: boolean;
};

export type ClRouterGenerateResponse = {
  output: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };
  costUsd: number | null;
  costStatus: "priced" | "unpriced";
  model: ClRouterModelRoute;
  routing: ClRouterRoutingMetadata;
  finishReason?: string;
  requestId: string;
};

export type ClRouterClient = {
  generate(input: ClRouterGenerateInput): Promise<ClRouterGenerateResponse>;
};

export type ClRouterGenerateInput = Omit<
  ClRouterGenerateRequest,
  "messages" | "prompt"
> & {
  prompt: string;
  assets?: ClRouterProviderAssets;
};

export type ClRouterClientOptions = {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  fetch?: typeof fetch;
};

export class ClRouterConnectionError extends Error {
  readonly kind: "connection" | "timeout";

  constructor(kind: "connection" | "timeout", cause: unknown) {
    super(kind === "timeout" ? "cl-router request timed out" : "cl-router connection failed", {
      cause,
    });
    this.name = "ClRouterConnectionError";
    this.kind = kind;
  }
}

export class ClRouterHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`cl-router returned HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "ClRouterHttpError";
    this.status = status;
  }
}

export class ClRouterProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClRouterProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isModelRoute(value: unknown): value is ClRouterModelRoute {
  return isRecord(value) && typeof value.provider === "string" && value.provider.length > 0
    && typeof value.model === "string" && value.model.length > 0;
}

function parseGenerateResponse(value: unknown): ClRouterGenerateResponse {
  if (!isRecord(value) || !isModelRoute(value.model) || !isRecord(value.usage)
    || !isRecord(value.routing)) {
    throw new ClRouterProtocolError("cl-router returned an invalid generate response");
  }
  const usage = value.usage;
  const routing = value.routing;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  if (
    !isNonNegativeInteger(usage.inputTokens)
    || !isNonNegativeInteger(usage.outputTokens)
    || !isNonNegativeInteger(usage.cachedInputTokens)
    || !isNonNegativeInteger(cacheWriteTokens)
    || usage.cachedInputTokens + cacheWriteTokens > usage.inputTokens
    || (usage.reasoningTokens !== undefined && !isNonNegativeInteger(usage.reasoningTokens))
    || !(value.costUsd === null || (typeof value.costUsd === "number" && value.costUsd >= 0))
    || (value.costStatus !== "priced" && value.costStatus !== "unpriced")
    || typeof value.requestId !== "string"
    || value.requestId.length === 0
    || typeof routing.decision !== "string"
    || !Array.isArray(routing.candidatesConsidered)
    || !routing.candidatesConsidered.every(isModelRoute)
    || !(routing.policyVersion === null || typeof routing.policyVersion === "string")
    || typeof routing.cacheStickinessApplied !== "boolean"
    || !isNonNegativeInteger(routing.attemptCount)
    || routing.attemptCount < 1
    || (routing.routeSource !== undefined && typeof routing.routeSource !== "string")
    || (routing.shadowMode !== undefined && typeof routing.shadowMode !== "boolean")
    || (routing.wouldHaveMatched !== undefined && typeof routing.wouldHaveMatched !== "boolean")
    || (routing.wouldHaveChosen !== undefined && (
      !isRecord(routing.wouldHaveChosen)
      || !isModelRoute(routing.wouldHaveChosen)
      || typeof (routing.wouldHaveChosen as Record<string, unknown>).decision !== "string"
    ))
  ) {
    throw new ClRouterProtocolError("cl-router returned invalid generate metadata");
  }
  return {
    ...(value as ClRouterGenerateResponse),
    usage: {
      ...(usage as ClRouterGenerateResponse["usage"]),
      cacheWriteTokens,
    },
  };
}

function embeddedPdf(prompt: string): { text: string; pdfBase64: string } | null {
  const match = prompt.match(/^([\s\S]+?\n)(JVBER[A-Za-z0-9+/=\s]{200,})$/);
  if (!match) return null;
  return {
    text: (match[1] ?? "").trim(),
    pdfBase64: (match[2] ?? "").replace(/\s/g, ""),
  };
}

function requestInput(
  prompt: string,
  assets: ClRouterProviderAssets | undefined,
): Pick<ClRouterGenerateRequest, "messages" | "prompt"> {
  const images = (assets?.images ?? []).filter(
    (image) => typeof image.imageBase64 === "string" && image.imageBase64.length > 0,
  );
  const pdfBase64 = assets?.pdfBytes
    ? Buffer.from(assets.pdfBytes).toString("base64")
    : assets?.pdfBase64?.replace(/\s/g, "");
  if (images.length > 0 || pdfBase64) {
    return {
      messages: [{
        role: "user",
        content: [
          ...images.map((image): ClRouterMessagePart => ({
            type: "image",
            image: image.imageBase64,
            ...(image.mimeType ? { mediaType: image.mimeType } : {}),
          })),
          ...(pdfBase64
            ? [{
                type: "file" as const,
                data: pdfBase64,
                mediaType: assets?.mimeType ?? "application/pdf",
                filename: "document.pdf",
              }]
            : []),
          { type: "text", text: prompt },
        ],
      }],
    };
  }
  const extracted = embeddedPdf(prompt);
  if (extracted) {
    return {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: extracted.text },
          {
            type: "file",
            data: extracted.pdfBase64,
            mediaType: "application/pdf",
            filename: "document.pdf",
          },
        ],
      }],
    };
  }
  return { prompt };
}

export function buildClRouterGenerateRequest(
  input: ClRouterGenerateInput,
): ClRouterGenerateRequest {
  const { assets, prompt, ...rest } = input;
  return {
    ...rest,
    ...requestInput(prompt, assets),
  };
}

export function parseClRouterTaskFlags(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isClRouterTaskEnabled(
  flags: ReadonlySet<string>,
  task: string,
  taskKind?: string,
): boolean {
  if (flags.has("*") || flags.has(task) || (taskKind !== undefined && flags.has(taskKind))) {
    return true;
  }
  return taskKind !== "extraction_preview"
    && taskKind?.startsWith("extraction_") === true
    && flags.has("extraction");
}

export function shouldFallBackFromClRouter(error: unknown): boolean {
  return error instanceof ClRouterConnectionError
    || (error instanceof ClRouterHttpError && error.status >= 500 && error.status <= 599);
}

export function createClRouterClient(options: ClRouterClientOptions): ClRouterClient {
  const baseUrl = new URL(options.baseUrl);
  const isLoopback = baseUrl.hostname === "localhost"
    || baseUrl.hostname === "127.0.0.1"
    || baseUrl.hostname === "::1"
    || baseUrl.hostname === "[::1]";
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && isLoopback)) {
    throw new Error(
      "CL_ROUTER_URL must use HTTPS unless it targets loopback localhost, 127.0.0.1, or ::1",
    );
  }
  if (!options.secret.trim()) throw new Error("CL_ROUTER_SECRET is required when router tasks are enabled");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("CL_ROUTER_TIMEOUT_MS must be a positive integer");
  }
  const fetchImpl = options.fetch ?? fetch;
  const generateUrl = new URL("v1/generate", `${baseUrl.toString().replace(/\/$/, "")}/`);

  return {
    async generate(input) {
      const signal = AbortSignal.timeout(options.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(generateUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildClRouterGenerateRequest(input)),
          signal,
        });
      } catch (error) {
        throw new ClRouterConnectionError(signal.aborted ? "timeout" : "connection", error);
      }
      if (!response.ok) throw new ClRouterHttpError(response.status, response.statusText);
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new ClRouterProtocolError(
          `cl-router returned non-JSON success response: ${error instanceof Error ? error.name : "unknown"}`,
        );
      }
      return parseGenerateResponse(body);
    },
  };
}
