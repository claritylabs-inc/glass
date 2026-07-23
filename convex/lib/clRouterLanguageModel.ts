"use node";

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  ClRouterRequestError,
  clRouterGenerate,
  clRouterGenerateStream,
  isClRouterDirectFallbackError,
  type ClRouterClientOptions,
  type ClRouterGenerateRequest,
  type ClRouterGenerateResponse,
  type ClRouterMessage,
  type ClRouterMessagePart,
  type ClRouterResponseMetadata,
  type ClRouterSettingsSnapshot,
  type ClRouterToolChoice,
  type ClRouterToolDefinition,
  type ClRouterUsage,
} from "./clRouterClient";
import type { ModelRoute, ModelTask } from "./modelCatalog";

export type ClRouterLanguageModelStep = {
  step: number;
  hasTools: boolean;
  hasToolResults: boolean;
};

export type ClRouterLanguageModelOptions = {
  task: ModelTask;
  taskKind?: string;
  orgId?: string;
  settings: ClRouterSettingsSnapshot | null;
  sessionKey: string;
  trace?: ClRouterGenerateRequest["trace"];
  directModel: LanguageModelV3;
  client?: ClRouterClientOptions;
  onResponse?: (
    response: ClRouterResponseMetadata,
    step: ClRouterLanguageModelStep,
  ) => void | Promise<void>;
  onDirectFallback?: (
    error: unknown,
    step: ClRouterLanguageModelStep,
  ) => void | Promise<void>;
};

export class ClRouterVisibleOutputError extends Error {
  constructor(cause: unknown) {
    super("cl-router stream failed after visible output began", { cause });
    this.name = "ClRouterVisibleOutputError";
  }
}

function dataContent(data: Uint8Array | string | URL): string {
  if (data instanceof URL) return data.toString();
  return typeof data === "string" ? data : Buffer.from(data).toString("base64");
}

function messageParts(
  content: Exclude<LanguageModelV3Prompt[number]["content"], string>,
): ClRouterMessagePart[] {
  const parts: ClRouterMessagePart[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "text", text: part.text });
        break;
      case "file": {
        const data = dataContent(part.data);
        parts.push(part.mediaType.startsWith("image/")
          ? { type: "image", image: data, mediaType: part.mediaType }
          : {
            type: "file",
            data,
            mediaType: part.mediaType,
            ...(part.filename ? { filename: part.filename } : {}),
          });
        break;
      }
      case "tool-call":
        parts.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      case "tool-result":
        parts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
        break;
      case "reasoning":
        // Router providers should not receive hidden reasoning as ordinary text.
        break;
      case "tool-approval-response":
        throw new ClRouterRequestError(
          "configuration",
          "cl-router chat does not support provider-executed tool approvals",
        );
    }
  }
  return parts;
}

export function clRouterMessagesFromPrompt(prompt: LanguageModelV3Prompt): ClRouterMessage[] {
  return prompt.map((message): ClRouterMessage => {
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    return { role: message.role, content: messageParts(message.content) };
  });
}

function clRouterTools(
  tools: LanguageModelV3CallOptions["tools"],
): ClRouterToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((definition) => {
    if (definition.type !== "function") {
      throw new ClRouterRequestError(
        "configuration",
        "cl-router chat supports function tools only",
      );
    }
    if (
      !definition.inputSchema ||
      typeof definition.inputSchema !== "object" ||
      Array.isArray(definition.inputSchema)
    ) {
      throw new ClRouterRequestError(
        "configuration",
        `cl-router tool ${definition.name} requires an object JSON schema`,
      );
    }
    return {
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      inputSchema: definition.inputSchema as Record<string, unknown>,
    };
  });
}

function clRouterToolChoice(
  choice: LanguageModelV3CallOptions["toolChoice"],
): ClRouterToolChoice | undefined {
  if (!choice) return undefined;
  return choice.type === "tool"
    ? { type: "tool", toolName: choice.toolName }
    : choice.type;
}

function unsupportedWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const unsupported = [
    ["temperature", options.temperature],
    ["stopSequences", options.stopSequences],
    ["topP", options.topP],
    ["topK", options.topK],
    ["presencePenalty", options.presencePenalty],
    ["frequencyPenalty", options.frequencyPenalty],
    ["seed", options.seed],
  ] as const;
  return unsupported
    .filter(([, value]) => value !== undefined)
    .map(([feature]) => ({
      type: "unsupported" as const,
      feature,
      details: "cl-router v1 does not forward this sampling setting",
    }));
}

function requestForCall(
  adapter: ClRouterLanguageModelOptions,
  options: LanguageModelV3CallOptions,
  parentRequestId?: string,
  selectedRoute?: ModelRoute,
  allowFallback = true,
): ClRouterGenerateRequest {
  const responseFormat = options.responseFormat;
  const schema =
    responseFormat?.type === "json" && responseFormat.schema
      ? (responseFormat.schema as Record<string, unknown>)
      : undefined;
  const tools = clRouterTools(options.tools);
  const toolChoice = clRouterToolChoice(options.toolChoice);
  return {
    task: adapter.task,
    ...(adapter.taskKind ? { taskKind: adapter.taskKind } : {}),
    ...(adapter.orgId ? { orgId: adapter.orgId } : {}),
    settings: adapter.settings,
    messages: clRouterMessagesFromPrompt(options.prompt),
    ...(schema
      ? {
        schema,
        schemaDialect: "https://json-schema.org/draft/2020-12/schema" as const,
      }
      : {}),
    ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}),
    sessionKey: adapter.sessionKey,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { toolChoice } : {}),
    routing: {
      ...(selectedRoute ? { pin: selectedRoute } : {}),
      allowFallback,
    },
    ...(adapter.trace || parentRequestId
      ? {
          trace: {
            ...adapter.trace,
            ...(parentRequestId ? { parentRequestId } : {}),
          },
        }
      : {}),
  };
}

function promptHasToolResults(prompt: LanguageModelV3Prompt): boolean {
  return prompt.some(
    (message) =>
      message.role !== "system" &&
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "tool-result"),
  );
}

function languageModelUsage(usage: ClRouterUsage): LanguageModelV3Usage {
  const reasoning = usage.reasoningTokens ?? 0;
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
      ),
      cacheRead: usage.cachedInputTokens,
      cacheWrite: usage.cacheWriteTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: Math.max(0, usage.outputTokens - reasoning),
      reasoning,
    },
  };
}

function finishReason(raw: string): LanguageModelV3FinishReason {
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  const unified = normalized === "stop" || normalized === "length" ||
    normalized === "content-filter" || normalized === "tool-calls" ||
    normalized === "error"
    ? normalized
    : "other";
  return { unified, raw };
}

function providerMetadata(metadata: ClRouterResponseMetadata): SharedV3ProviderMetadata {
  return {
    "cl-router": {
      requestId: metadata.requestId,
      model: metadata.model,
      routing: metadata.routing,
      costUsd: metadata.costUsd,
      costStatus: metadata.costStatus,
    },
  } as unknown as SharedV3ProviderMetadata;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function jsonInput(input: unknown): string {
  const serialized = JSON.stringify(input);
  if (serialized === undefined) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router returned a non-serializable tool input",
    );
  }
  return serialized;
}

function generatedContent(response: ClRouterGenerateResponse): LanguageModelV3Content[] {
  if (typeof response.output === "string") {
    return response.output ? [{ type: "text", text: response.output }] : [];
  }
  if (response.output && typeof response.output === "object") {
    const output = response.output as Record<string, unknown>;
    const content: LanguageModelV3Content[] = [];
    if (typeof output.text === "string" && output.text) {
      content.push({ type: "text", text: output.text });
    }
    if (Array.isArray(output.toolCalls)) {
      for (const value of output.toolCalls) {
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as Record<string, unknown>).toolCallId !== "string" ||
          typeof (value as Record<string, unknown>).toolName !== "string"
        ) {
          throw new ClRouterRequestError(
            "invalid_response",
            "cl-router returned an invalid generated tool call",
          );
        }
        const call = value as Record<string, unknown>;
        content.push({
          type: "tool-call",
          toolCallId: call.toolCallId as string,
          toolName: call.toolName as string,
          input: jsonInput(call.input),
        });
      }
      return content;
    }
  }
  return [{ type: "text", text: JSON.stringify(response.output) }];
}

async function pipeStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function createClRouterLanguageModel(
  adapter: ClRouterLanguageModelOptions,
): LanguageModelV3 {
  let parentRequestId = adapter.trace?.parentRequestId;
  let selectedRoute: ModelRoute | undefined;
  let successfulRouterSteps = 0;
  let useDirectForRun = false;
  const clientOptions = (
    abortSignal: AbortSignal | undefined,
  ): ClRouterClientOptions => ({
    ...adapter.client,
    abortSignal,
  });
  const stepContext = (
    options: LanguageModelV3CallOptions,
  ): ClRouterLanguageModelStep => ({
    step: successfulRouterSteps + 1,
    hasTools: (options.tools?.length ?? 0) > 0,
    hasToolResults: promptHasToolResults(options.prompt),
  });
  const notifyResponse = async (
    response: ClRouterResponseMetadata,
    step: ClRouterLanguageModelStep,
  ) => {
    try {
      await adapter.onResponse?.(response, step);
    } catch (error) {
      console.warn("[cl-router] Failed to record routed model response", error);
    }
  };
  const switchRunToDirect = async (
    error: unknown,
    step: ClRouterLanguageModelStep,
  ) => {
    useDirectForRun = true;
    try {
      await adapter.onDirectFallback?.(error, step);
    } catch (recordingError) {
      console.warn(
        "[cl-router] Failed to record direct fallback",
        recordingError,
      );
    }
  };

  return {
    specificationVersion: "v3",
    provider: "cl-router",
    modelId: `cl-router/${adapter.task}`,
    supportedUrls: {},

    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      if (useDirectForRun) return adapter.directModel.doGenerate(options);
      const step = stepContext(options);
      const request = requestForCall(
        adapter,
        options,
        parentRequestId,
        selectedRoute,
        successfulRouterSteps === 0,
      );
      try {
        const response = await clRouterGenerate(
          request,
          clientOptions(options.abortSignal),
        );
        parentRequestId = response.requestId;
        selectedRoute = response.model;
        successfulRouterSteps += 1;
        await notifyResponse(response, step);
        return {
          content: generatedContent(response),
          finishReason: finishReason(response.finishReason ?? "stop"),
          usage: languageModelUsage(response.usage),
          providerMetadata: providerMetadata(response),
          response: {
            id: response.requestId,
            modelId: `${response.model.provider}/${response.model.model}`,
          },
          warnings: unsupportedWarnings(options),
        };
      } catch (error) {
        if (
          successfulRouterSteps > 0 ||
          !isClRouterDirectFallbackError(error)
        ) {
          throw error;
        }
        await switchRunToDirect(error, step);
        return adapter.directModel.doGenerate(options);
      }
    },

    async doStream(options): Promise<LanguageModelV3StreamResult> {
      if (useDirectForRun) return adapter.directModel.doStream(options);
      const step = stepContext(options);
      const request = requestForCall(
        adapter,
        options,
        parentRequestId,
        selectedRoute,
        successfulRouterSteps === 0,
      );
      let response: Awaited<ReturnType<typeof clRouterGenerateStream>>;
      try {
        response = await clRouterGenerateStream(
          request,
          clientOptions(options.abortSignal),
        );
      } catch (error) {
        if (
          successfulRouterSteps > 0 ||
          !isClRouterDirectFallbackError(error)
        ) {
          throw error;
        }
        await switchRunToDirect(error, step);
        return adapter.directModel.doStream(options);
      }

      return {
        response: { headers: responseHeaders(response.headers) },
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              let visibleRouterOutput = false;
              let started = false;
              const activeTextIds = new Set<string>();
              let receivedDone = false;
              const startStream = () => {
                if (started) return;
                started = true;
                controller.enqueue({
                  type: "stream-start",
                  warnings: unsupportedWarnings(options),
                });
              };
              try {
                for await (const event of response.events) {
                  if (receivedDone) {
                    throw new ClRouterRequestError(
                      "invalid_response",
                      "cl-router emitted stream output after done",
                    );
                  }
                  if (event.type === "text-delta") {
                    if (!event.delta) continue;
                    visibleRouterOutput = true;
                    startStream();
                    if (!activeTextIds.has(event.id)) {
                      activeTextIds.add(event.id);
                      controller.enqueue({ type: "text-start", id: event.id });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: event.id,
                      delta: event.delta,
                    });
                  } else if (event.type === "tool-call") {
                    visibleRouterOutput = true;
                    startStream();
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: event.toolCallId,
                      toolName: event.toolName,
                      input: jsonInput(event.input),
                    });
                  } else if (event.type === "error") {
                    throw new ClRouterRequestError(
                      event.error.retryable ? "server" : "client",
                      `cl-router stream failed (${event.error.code})`,
                    );
                  } else {
                    receivedDone = true;
                    parentRequestId = event.requestId;
                    selectedRoute = event.model;
                    successfulRouterSteps += 1;
                    await notifyResponse(event, step);
                    startStream();
                    for (const id of activeTextIds) {
                      controller.enqueue({ type: "text-end", id });
                    }
                    controller.enqueue({
                      type: "response-metadata",
                      id: event.requestId,
                      modelId: `${event.model.provider}/${event.model.model}`,
                    });
                    controller.enqueue({
                      type: "finish",
                      finishReason: finishReason(event.finishReason),
                      usage: languageModelUsage(event.usage),
                      providerMetadata: providerMetadata(event),
                    });
                  }
                }
                if (!receivedDone) {
                  throw new ClRouterRequestError(
                    "invalid_response",
                    "cl-router stream ended without a done event",
                  );
                }
                controller.close();
              } catch (error) {
                if (
                  !visibleRouterOutput &&
                  successfulRouterSteps === 0 &&
                  isClRouterDirectFallbackError(error)
                ) {
                  try {
                    await switchRunToDirect(error, step);
                    const fallback =
                      await adapter.directModel.doStream(options);
                    await pipeStream(fallback.stream, controller);
                    controller.close();
                  } catch (fallbackError) {
                    controller.error(fallbackError);
                  }
                  return;
                }
                controller.error(
                  visibleRouterOutput ? new ClRouterVisibleOutputError(error) : error,
                );
              }
            })();
          },
        }),
      };
    },
  };
}
