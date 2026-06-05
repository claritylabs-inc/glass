"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateCoiPdf, policyToCoiData, formatSecurityPanel } from "../lib/coiGenerator";
import { renderCoiPdfOverlay, type CoiOverlayMapping } from "../lib/coiTemplateOverlay";
import { logAiError } from "../lib/aiUtils";
import {
  generateTextWithFallback,
  getModelForOrg,
  getProviderOptionsForTask,
} from "../lib/models";
import {
  formatDocumentMetadataForPrompt,
  formatDocumentOutlineForPrompt,
  getPolicyDocumentMetadata,
  getPolicyDocumentOutline,
} from "../lib/policyDocumentStructure";
import { coverageBreakdownForTool } from "../lib/coverageBreakdown";

type OverlayFieldMapping = {
  fields?: Array<Record<string, unknown>>;
};

function cleanFilenamePart(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 90).trim();
}

function stringifyFilenameToken(value: unknown, fallback = "") {
  return cleanFilenamePart(value, fallback);
}

function buildCoiFileName(
  policy: Record<string, unknown>,
  certificateHolder?: string,
  certificateHolderName?: string,
  outputFileName?: string,
) {
  const holder = cleanFilenamePart(
    certificateHolderName ?? certificateHolder?.split(/\r?\n/)[0],
    "certificate-holder",
  );
  const policyRef = cleanFilenamePart(
    policy.policyNumber ?? policy.security ?? policy.carrier,
    "policy",
  );
  const fallback = `COI - ${holder} - ${policyRef}.pdf`;
  const template = outputFileName?.trim();
  if (!template) return fallback;

  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const normalized = key.toLowerCase();
    const values: Record<string, string> = {
      holder,
      certificate_holder: holder,
      policy: policyRef,
      policy_number: policyRef,
      carrier: stringifyFilenameToken(policy.carrier ?? policy.security ?? policy.carrierLegalName, "carrier"),
      insured: stringifyFilenameToken(policy.insuredName ?? policy.namedInsured, "insured"),
      date: dayjs().format("YYYY-MM-DD"),
    };
    return values[normalized] ?? "";
  });
  const withoutExtension = rendered.replace(/\.pdf$/i, "");
  const clean = cleanFilenamePart(withoutExtension, "").slice(0, 120).trim();
  return clean ? `${clean}.pdf` : fallback;
}

function trimForPrompt(value: unknown, maxLength = 24000): string {
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 1800) return `${item.slice(0, 1800)}...`;
    return item;
  }, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function cleanCustomSmartValue(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-z]*\n?/gi, "").replace(/```/g, ""))
    .replace(/^["']|["']$/g, "")
    .trim()
    .slice(0, 600);
}

async function resolveCustomSmartFields(
  ctx: Parameters<typeof getModelForOrg>[0],
  orgId: Parameters<typeof getModelForOrg>[1],
  policy: Record<string, unknown>,
  program: Record<string, unknown> | null,
  coiData: ReturnType<typeof policyToCoiData>,
  mapping: unknown,
): Promise<CoiOverlayMapping> {
  const fieldMapping = (mapping ?? {}) as OverlayFieldMapping;
  const fields = Array.isArray(fieldMapping.fields) ? fieldMapping.fields : [];
  const customFields = fields.filter(
    (field) => field.type === "custom_smart" && typeof field.customPrompt === "string" && field.customPrompt.trim(),
  );
  if (customFields.length === 0) return fieldMapping as CoiOverlayMapping;

  const documentMetadata = getPolicyDocumentMetadata(policy);
  const documentOutline = getPolicyDocumentOutline(policy);
  const sourceNodes = policy._id
    ? await ctx.runQuery((internal as any).sourceNodes.listByPolicyInternal, {
        policyId: policy._id,
      }).catch(() => [])
    : [];
  const policyContext = trimForPrompt({
    operationalProfile: policy.operationalProfile,
    coverageBreakdown: coverageBreakdownForTool(policy),
    policyNumber: policy.policyNumber,
    policyTypes: policy.policyTypes,
    carrier: policy.carrier ?? policy.security ?? policy.carrierLegalName,
    insuredName: policy.insuredName,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    limits: policy.limits,
    coverages: policy.coverages,
    deductibles: policy.deductibles,
    premiumBreakdown: policy.premiumBreakdown,
    taxesAndFees: policy.taxesAndFees,
    formInventory: policy.formInventory,
    declarations: policy.declarations,
    supplementaryFacts: policy.supplementaryFacts,
    documentMetadata,
    documentOutline,
    documentMetadataSummary: formatDocumentMetadataForPrompt(policy, {
      maxChars: 5000,
      includeSourceSpanIds: true,
    }),
    documentOutlineSummary: formatDocumentOutlineForPrompt(policy, {
      maxNodes: 24,
      maxChars: 7000,
      includeSourceSpanIds: true,
    }),
    sourceTreeEvidence: Array.isArray(sourceNodes)
      ? sourceNodes.slice(0, 80).map((node: any) => ({
          nodeId: node.nodeId,
          kind: node.kind,
          path: node.path,
          title: node.title,
          pages: node.pageStart ? `${node.pageStart}${node.pageEnd && node.pageEnd !== node.pageStart ? `-${node.pageEnd}` : ""}` : undefined,
          sourceSpanIds: node.sourceSpanIds,
          text: [node.description, node.textExcerpt].filter(Boolean).join("\n").slice(0, 1600),
        }))
      : [],
    partnerProgram: program
      ? {
          name: program.name,
          securityPanel: program.securityPanel,
        }
      : undefined,
  });
  const coiContext = trimForPrompt(coiData, 12000);

  const resolved = await Promise.all(
    customFields.slice(0, 12).map(async (field) => {
      const prompt = `You are filling a custom smart field on a Certificate of Insurance PDF.

Return only the final field value. Do not include markdown, explanation, labels, or citations.
If the requested value is not available from the policy or certificate data, return an empty string.
Keep the value concise enough to fit in a PDF field.

Field label: ${String(field.label ?? "Custom smart field")}
User autofill prompt: ${String(field.customPrompt)}

Certificate data:
${coiContext}

Policy data:
${policyContext}`;

      const { text } = await generateTextWithFallback({
        model: await getModelForOrg(ctx, orgId, "summary"),
        providerOptions: getProviderOptionsForTask("summary"),
        maxOutputTokens: 160,
        messages: [{ role: "user", content: prompt }],
      }, {
        task: "summary",
        taskKind: "query_reason",
      });

      return [field.id, cleanCustomSmartValue(text)] as const;
    }),
  );
  const valuesById = new Map(resolved);

  return {
    ...fieldMapping,
    fields: fields.map((field) =>
      typeof field.id === "string" && valuesById.has(field.id)
        ? { ...field, value: valuesById.get(field.id) }
        : field,
    ),
  } as CoiOverlayMapping;
}

/**
 * Generate a COI PDF for a policy and store it in file storage.
 * Returns the storage ID and byte size for download/attachment metadata.
 */
export const run = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(v.union(
      v.literal("policy_page"),
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("sms"),
      v.literal("api"),
      v.literal("mcp"),
      v.literal("agent"),
      v.literal("unknown"),
    )),
    createdByUserId: v.optional(v.id("users")),
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("certified"),
        v.literal("declined"),
      ),
    ),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalMode: v.optional(v.union(
      v.literal("auto_approve_all"),
      v.literal("require_approval_all"),
      v.literal("llm_review"),
    )),
    approvalAudit: v.optional(v.any()),
    disclaimer: v.optional(v.string()),
    certificateHolderId: v.optional(v.id("certificateHolders")),
    policyVersionId: v.optional(v.id("policyVersions")),
    existingCertificateId: v.optional(v.id("certificates")),
  },
  handler: async (ctx, args): Promise<{ storageId: string; size: number; fileName: string; certificateId: string }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const coiData = policyToCoiData(policy);
      const program = args.partnerProgramId
        ? await ctx.runQuery(internal.partnerPrograms.getProgramInternal, {
            programId: args.partnerProgramId,
          })
        : null;
      if (program?.securityPanel?.length) {
        const securityPanel = program.securityPanel;
        coiData.securityPanel = securityPanel;
        coiData.insurers = securityPanel.slice(0, 6).map((member: any, index: number) => ({
          letter: String.fromCharCode(65 + index),
          name: `${member.name} (${member.participationPercent}%)`,
        }));
        coiData.description = [
          coiData.description,
          `Security panel:\n${formatSecurityPanel(securityPanel)}`,
        ].filter(Boolean).join("\n\n");
      }
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }
      coiData.authorityType = args.authorityType ?? "non_binding";
      coiData.certificationStatus = args.certificationStatus ?? "not_applicable";
      coiData.certificationNotice = args.disclaimer;

      let pdfBuffer: Buffer | null = null;
      let outputFileName: string | undefined;
      if (args.templateId) {
        const template = await ctx.runQuery(internal.partnerPrograms.getTemplateInternal, {
          templateId: args.templateId,
        });
        outputFileName = template?.outputFileName;
        const kind = template?.templateKind;
        if (kind === "pdf_overlay" && template?.fileId) {
          try {
            const templateBlob = await ctx.storage.get(template.fileId);
            if (!templateBlob) throw new Error("Template PDF not found");
            const fieldMappings = await resolveCustomSmartFields(
              ctx,
              args.orgId,
              policy as Record<string, unknown>,
              program as Record<string, unknown> | null,
              coiData,
              template.fieldMappings ?? {},
            );
            pdfBuffer = await renderCoiPdfOverlay(
              await templateBlob.arrayBuffer(),
              coiData,
              fieldMappings,
            );
          } catch (error) {
            if (template.fallbackToStandard === false) throw error;
            console.warn(
              `Falling back to standard Glass COI template: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }

      if (!pdfBuffer) {
        pdfBuffer = await generateCoiPdf(coiData);
      }

      // Store in Convex file storage
      // Copy to a plain ArrayBuffer to satisfy strict Blob typing
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const storageId = await ctx.storage.store(blob);
      const size = pdfBuffer.byteLength;
      const fileName = buildCoiFileName(
        policy,
        args.certificateHolder,
        args.certificateHolderName,
        outputFileName,
      );

      const certificateId = await ctx.runMutation(internal.certificates.recordGenerated, {
        orgId: args.orgId,
        policyId: args.policyId,
        fileId: storageId,
        fileName,
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        source: args.source,
        createdByUserId: args.createdByUserId,
        authorityType: args.authorityType,
        certificationStatus: args.certificationStatus,
        partnerOrgId: args.partnerOrgId,
        partnerProgramId: args.partnerProgramId,
        templateId: args.templateId,
        standingAuthorizationId: args.standingAuthorizationId,
        approvalMode: args.approvalMode,
        approvalAudit: args.approvalAudit,
        disclaimer: args.disclaimer,
        certificateHolderId: args.certificateHolderId,
        policyVersionId: args.policyVersionId,
        existingCertificateId: args.existingCertificateId,
      });

      return { storageId: storageId as string, size, fileName, certificateId: String(certificateId) };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
