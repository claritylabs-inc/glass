import type { Id } from "../_generated/dataModel";
import type { EmailSubagentResult } from "./emailSubagent";

type ToolAttachment = {
  filename: string;
  fileId?: Id<"_storage">;
};

type ToolArtifact = {
  type: string;
  data: unknown;
};

export type ImessageResponseFileAttachment = {
  storageId: Id<"_storage">;
  filename: string;
};

export function createImessageAgentRunState(args: {
  relevantPolicyIds: Id<"policies">[];
}) {
  const responseFileAttachments: ImessageResponseFileAttachment[] = [];
  const toolArtifacts: ToolArtifact[] = [];
  let emailResult: EmailSubagentResult | null = null;

  return {
    responseFileAttachments,
    toolArtifacts,
    onPolicyReferenced(policyId: Id<"policies">) {
      if (!args.relevantPolicyIds.some((id) => String(id) === String(policyId))) {
        args.relevantPolicyIds.push(policyId);
      }
    },
    onResponseAttachment(attachment: ToolAttachment) {
      if (!attachment.fileId) return;
      responseFileAttachments.push({
        storageId: attachment.fileId,
        filename: attachment.filename,
      });
    },
    onToolArtifact(artifact: ToolArtifact) {
      toolArtifacts.push(artifact);
    },
    appendWorkflowOutcomes(workflowOutcomes: unknown[]) {
      for (const workflowOutcome of workflowOutcomes) {
        toolArtifacts.push({
          type: "workflow_outcome",
          data: workflowOutcome,
        });
      }
    },
    setEmailResult(result: EmailSubagentResult) {
      emailResult = result;
    },
    getEmailResult() {
      return emailResult;
    },
  };
}
