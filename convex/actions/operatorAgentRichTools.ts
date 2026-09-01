"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { AgentScope } from "../lib/agentScope";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { readStoredAgentFile } from "../lib/storedAgentFile";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("mcp"),
);

type Attachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

const RICH_POLICY_TOOLS = new Set([
  "lookup_policy",
  "compare_coverages",
  "lookup_policy_section",
  "attach_policy_document",
  "confirm_policy_fact",
  "lookup_compliance_requirements",
]);

export const runInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    toolName: v.string(),
    input: v.any(),
    channel: operatorChannelValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    result: unknown;
    attachments?: Attachment[];
  }> => {
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });

    if (RICH_POLICY_TOOLS.has(args.toolName)) {
      const input = args.input as Record<string, unknown>;
      const orgId = input.orgId as Id<"organizations">;
      const organization = await ctx.runQuery(internal.orgs.getInternal, {
        id: orgId,
      });
      if (!organization || organization.type !== "client") {
        throw new Error("Client organization not found");
      }
      if (args.toolName === "confirm_policy_fact") {
        const policyId = input.policyId as Id<"policies">;
        const policyAccess = await ctx.runQuery(
          internal.operator.requireOperatorPolicyWriteForUserInternal,
          { userId: args.operatorUserId, policyId },
        );
        if (policyAccess.orgId !== orgId) throw new Error("Policy not found");
      }
      const surface = args.channel === "mcp" ? "mcp" : "web";
      const scope: AgentScope = {
        mode: "client",
        surface,
        primaryOrgId: orgId,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        orgs: [
          {
            orgId,
            name: organization.name,
            type: "client",
            isPrimary: true,
            canWrite: true,
          },
        ],
        brokerInternal: false,
      };
      const attachments: Attachment[] = [];
      const executors = buildAgentToolExecutors(ctx, {
        surface,
        orgId,
        userId: args.operatorUserId,
        scope,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        canWrite: true,
        onResponseAttachment: (attachment) => {
          if (!attachment.fileId) return;
          attachments.push({
            fileId: attachment.fileId,
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          });
        },
      });
      const executor = executors[args.toolName as keyof typeof executors];
      if (!executor || typeof executor.execute !== "function") {
        throw new Error(`Unsupported operator action tool: ${args.toolName}`);
      }
      const { orgId: _orgId, ...toolInput } = input;
      const result = await executor.execute(toolInput as never, {
        toolCallId: `operator:${args.toolName}`,
        messages: [],
      });
      return { result, attachments };
    }

    if (
      args.toolName === "read_client_file" ||
      args.toolName === "attach_client_file"
    ) {
      const input = args.input as Record<string, unknown>;
      const file = await ctx.runQuery(
        internal.clientFiles.getForOperatorInternal,
        {
          operatorUserId: args.operatorUserId,
          clientFileId: input.clientFileId as Id<"clientFiles">,
        },
      );
      if (!file) throw new Error("Client file not found");
      if (args.toolName === "attach_client_file") {
        return {
          result: {
            status: "attached",
            clientFileId: file.clientFileId,
            name: file.name,
          },
          attachments: [
            {
              fileId: file.fileId,
              filename: file.name,
              contentType: file.contentType,
              size: file.size,
            },
          ],
        };
      }
      return {
        result: await readStoredAgentFile(ctx, {
          fileId: file.fileId,
          filename: file.name,
          contentType: file.contentType,
          size: file.size,
        }),
      };
    }

    if (args.toolName === "search_thread_history") {
      const input = args.input as Record<string, unknown>;
      return {
        result: await ctx.runQuery(
          internal.operatorAgent.searchThreadHistoryInternal,
          {
            operatorUserId: args.operatorUserId,
            threadId: args.threadId,
            query: String(input.query),
            limit: typeof input.limit === "number" ? input.limit : undefined,
          },
        ),
      };
    }

    if (args.toolName === "read_thread_attachment") {
      const input = args.input as Record<string, unknown>;
      const attachment = await ctx.runQuery(
        internal.operatorAgent.getThreadAttachmentInternal,
        {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          messageId: input.messageId as Id<"operatorAgentMessages">,
          filename: String(input.filename),
        },
      );
      if (!attachment) throw new Error("Operator thread attachment not found");
      return { result: await readStoredAgentFile(ctx, attachment) };
    }

    throw new Error(`Unsupported operator rich action tool: ${args.toolName}`);
  },
});
