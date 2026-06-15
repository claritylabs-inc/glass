"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PageContext } from "@/hooks/use-page-context";
import { getPublicAgentDomain } from "@/lib/domains";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useThreadCacheActions } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  optimisticPromptAttachments,
  promptReferenceIds,
  uploadPromptFiles,
} from "@/lib/thread-prompt";

const AGENT_DOMAIN = getPublicAgentDomain();

export function useStartAgentThread(cacheKeyPrefix: string) {
  const router = useRouter();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const viewerOrg = useCachedQuery(
    `${cacheKeyPrefix}.viewerOrg`,
    api.orgs.viewerOrg,
    {},
  );
  const viewer = useCachedQuery(
    `${cacheKeyPrefix}.viewer`,
    api.users.viewer,
    {},
  );
  const {
    appendOptimisticSend,
    markOptimisticSendFailed,
    seedOptimisticThread,
  } = useThreadCacheActions();
  const agentBranding =
    viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
      ? {
          name: `${viewerOrg.brokerOrg.name} Agent`,
          iconUrl: viewerOrg.brokerOrg.iconUrl,
        }
      : undefined;

  const startAgentThread = useCallback(
    async (
      message: PromptInputMessage,
      initialContext?: PageContext,
    ): Promise<Id<"threads"> | null> => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return null;

      const content = text || "(attached files)";
      const clientMutationId = createClientMutationId("message");
      const referenceIds = promptReferenceIds(message.references);

      let threadId: Id<"threads">;
      try {
        threadId = await createThread({
          initialContext,
          agentDomain: AGENT_DOMAIN,
          clientMutationId: createClientMutationId("thread"),
        });

        if (viewerOrg?.org?._id && viewer?._id) {
          await seedOptimisticThread({
            threadId,
            orgId: viewerOrg.org._id,
            createdBy: viewer._id,
            initialContext,
          });
          await appendOptimisticSend({
            threadId,
            orgId: viewerOrg.org._id,
            content,
            clientMutationId,
            userId: viewer._id,
            userName: viewer.name ?? viewer.email ?? "You",
            attachments: optimisticPromptAttachments(message.files),
            ...referenceIds,
          });
        }

        router.push(`/agent/thread/${threadId}`);
      } catch (error) {
        toast.error("Failed to start chat");
        throw error;
      }

      void (async () => {
        try {
          const attachments = await uploadPromptFiles(
            message.files,
            generateUploadUrl,
          );
          await sendThreadMessage({
            threadId,
            content,
            attachments: attachments.length > 0 ? attachments : undefined,
            ...referenceIds,
            clientMutationId,
          });
        } catch (error) {
          if (viewerOrg?.org?._id) {
            await markOptimisticSendFailed({
              threadId,
              clientMutationId,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to send message",
            });
          }
          toast.error("Failed to send message");
        }
      })();

      return threadId;
    },
    [
      appendOptimisticSend,
      createThread,
      generateUploadUrl,
      markOptimisticSendFailed,
      router,
      seedOptimisticThread,
      sendThreadMessage,
      viewer,
      viewerOrg,
    ],
  );

  return { agentBranding, startAgentThread, viewerOrg };
}
