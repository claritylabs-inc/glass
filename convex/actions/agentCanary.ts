"use node";

import dayjs from "dayjs";
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { generateAgentTextForPublicTask } from "../lib/models";

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = dayjs();
    let toolExecuted = false;
    let directBreakGlassUsed = false;
    const result = await generateAgentTextForPublicTask(
      ctx,
      "chat",
      {
        maxOutputTokens: 64,
        system:
          "This is a production health canary. Call report_canary exactly once with status ok. Do not answer in text.",
        prompt: "Run the production agent canary now.",
        tools: {
          report_canary: tool({
            description: "Reports that the production chat tool loop is healthy.",
            inputSchema: z.object({ status: z.literal("ok") }),
            execute: async ({ status }) => {
              toolExecuted = status === "ok";
              return { status };
            },
          }),
        },
        toolChoice: { type: "tool", toolName: "report_canary" },
        stopWhen: stepCountIs(1),
      },
      {
        sessionKey: "production-chat-canary",
        taskKind: "query_reason",
        trace: {
          traceId: `agent-canary:${startedAt.valueOf()}`,
          label: "convex.agentCanary",
          phase: "production_canary",
          channel: "canary",
        },
        onDirectFallback: () => {
          directBreakGlassUsed = true;
        },
      },
    );

    if (!toolExecuted) {
      throw new Error("Production chat canary did not execute its required tool");
    }
    if (result.fallback) {
      throw new Error(
        `Production chat canary was degraded: ${result.fallback.from.provider}/${result.fallback.from.model} fell back to ${result.fallback.to.provider}/${result.fallback.to.model}`,
      );
    }
    if (directBreakGlassUsed) {
      throw new Error(
        "Production chat canary was degraded: cl-router direct break-glass was used",
      );
    }
    const routerRouting = result.clRouter?.routing;
    if (
      routerRouting &&
      (routerRouting.routeSource === "fallback" ||
        routerRouting.attemptCount > 1)
    ) {
      throw new Error(
        `Production chat canary was degraded: cl-router used ${routerRouting.attemptCount} attempts from ${routerRouting.routeSource ?? "an unknown route source"}`,
      );
    }

    return {
      status: "healthy" as const,
      provider: result.route.provider,
      model: result.route.model,
      transport: result.transport,
      durationMs: dayjs().diff(startedAt, "millisecond"),
    };
  },
});
