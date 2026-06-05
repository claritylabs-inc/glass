"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildEmailPayload,
  buildEmailSignature,
  resolveEmailAgentIdentity,
  toResendAttachments,
} from "../lib/emailSubagent";
import { sendResendEmail } from "../lib/resend";

function holderAddressBlock(holder: {
  displayName: string;
  address?: {
    formatted?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
}) {
  const cityStateZip = [
    holder.address?.city,
    [holder.address?.state, holder.address?.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return [
    holder.displayName,
    holder.address?.formatted,
    holder.address?.line1,
    holder.address?.line2,
    cityStateZip,
  ].filter(Boolean).join("\n");
}

export const send = action({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    sendNotes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: "sent"; fileId: Id<"_storage">; certificateVersionId?: string }> => {
    const prepared = await ctx.runMutation(api.certificateWorkflowJobs.prepareSendJob, {
      jobId: args.jobId,
    }) as any;
    try {
      const generated = await ctx.runAction(internal.certificates.generateForOrg, {
        orgId: prepared.job.orgId,
        policyId: prepared.job.policyId,
        holderName: prepared.holder.displayName,
        certificateHolder: holderAddressBlock(prepared.holder),
        source: "agent",
        createdByUserId: prepared.userId,
        forceReissue: true,
      }) as any;
      if (!generated?.fileId) {
        throw new Error("Certificate generation did not produce a PDF.");
      }

      const identity = await resolveEmailAgentIdentity(ctx, prepared.org);
      if (!identity.canSend || !identity.agentAddress || !identity.fromHeader) {
        throw new Error(identity.reason ?? "Email sending is not configured.");
      }
      const signature = buildEmailSignature(identity.agentAddress, identity.brokerBranding);
      const subject = `Certificate of Insurance - ${prepared.holder.displayName}`;
      const body = [
        `Attached is the updated certificate of insurance for ${prepared.holder.displayName}.`,
        args.sendNotes,
      ].filter(Boolean).join("\n\n");
      const payload = buildEmailPayload({
        fromHeader: identity.fromHeader,
        to: prepared.job.recipientEmail,
        cc: [],
        bcc: [],
        subject,
        body,
        signature,
      });
      payload.attachments = await toResendAttachments(ctx, [{
        filename: generated.fileName ?? "certificate-of-insurance.pdf",
        contentType: "application/pdf",
        size: generated.size ?? 0,
        fileId: generated.fileId as Id<"_storage">,
      }]);
      const sent = await sendResendEmail(payload as Parameters<typeof sendResendEmail>[0], {
        retries: 2,
      });
      if (!sent.ok) throw new Error(sent.error);

      await ctx.runMutation(internal.certificateWorkflowJobs.markSentInternal, {
        jobId: args.jobId,
        generatedCertificateVersionId: generated.certificateVersionId as Id<"certificateVersions"> | undefined,
        sentByUserId: prepared.userId,
      });
      return {
        status: "sent",
        fileId: generated.fileId as Id<"_storage">,
        certificateVersionId: generated.certificateVersionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.certificateWorkflowJobs.markFailedInternal, {
        jobId: args.jobId,
        error: message,
      });
      throw error;
    }
  },
});
