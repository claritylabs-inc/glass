import {
  parseCertificateHolderBlock,
  type CertificateHolderAddressInput,
} from "../certificateIdentity";
import { inferCertificateEndorsements } from "../certificateRequestGate";
import { workflowCommsPlan, workflowToolMessage } from "./comms";
import type {
  WorkflowArtifact,
  WorkflowAuditEntry,
  WorkflowOutcome,
  WorkflowSideEffect,
  WorkflowSlot,
  WorkflowToolResult,
} from "./types";

export type CertificateRequestNextAction =
  | "return_existing_certificate"
  | "ask_for_holder_address"
  | "generate_certificate"
  | "hold_for_broker_follow_up"
  | "request_program_approval"
  | "choose_program"
  | "wait_for_extraction"
  | "wait_for_source_tree"
  | "report_failure";

export type CertificateRequestWorkflowParams = {
  policyId: string;
  holderName: string;
  certificateHolder?: string;
  holderContactName?: string;
  holderEmail?: string;
  holderPhone?: string;
  holderAddress?: CertificateHolderAddressInput;
  requestText?: string;
  requestedEndorsements?: string[];
};

export const CERTIFICATE_FORBIDDEN_QUESTIONS = [
  "holderEmail",
  "specialWording",
  "requestedEndorsements",
];

export const CERTIFICATE_FORBIDDEN_CLAIMS = [
  "certificate_generated_without_file",
  "certificate_emailed_without_send_side_effect",
  "certified_without_authority",
];

function hasAddress(address?: CertificateHolderAddressInput) {
  return Boolean(
    address?.formatted?.trim() ||
      address?.line1?.trim() ||
      address?.city?.trim() ||
      address?.state?.trim() ||
      address?.postalCode?.trim(),
  );
}

export function extractHolderAddress(params: CertificateRequestWorkflowParams) {
  return (
    params.holderAddress ??
    parseCertificateHolderBlock(params.certificateHolder, params.holderName).address
  );
}

export function certificateRequestRequiresEndorsementReview(
  params: CertificateRequestWorkflowParams,
) {
  return inferCertificateEndorsements({
    certificateHolder: params.certificateHolder,
    requestText: params.requestText,
    requestedEndorsements: params.requestedEndorsements,
  }).length > 0;
}

function baseAudit(params: CertificateRequestWorkflowParams): WorkflowAuditEntry[] {
  return [
    {
      step: "intake_received",
      decision: "parsed_holder",
      detail: params.holderName,
    },
    {
      step: "endorsement_intent_classified",
      decision: certificateRequestRequiresEndorsementReview(params)
        ? "endorsement_review_required"
        : "holder_only",
    },
  ];
}

export function certificateAddressRequiredOutcome(
  params: CertificateRequestWorkflowParams,
): WorkflowToolResult<{
  status: "needs_holder_address";
  policyId: string;
  holderName: string;
}> {
  const requiredSlots: WorkflowSlot[] = [
    {
      key: "holderAddress",
      label: "Certificate holder address",
      prompt: `What is the certificate holder address for ${params.holderName}?`,
      required: true,
      reason: "A new certificate needs the holder address printed on the COI.",
    },
  ];
  const outcome: WorkflowOutcome<"certificate_request", CertificateRequestNextAction> = {
    workflowKind: "certificate_request",
    status: "needs_input",
    nextAction: "ask_for_holder_address",
    requiredSlots,
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [],
    artifacts: [{ type: "certificate_holder", data: { holderName: params.holderName } }],
    comms: workflowCommsPlan({
      headline: `I can issue that certificate for ${params.holderName}.`,
      questions: requiredSlots.map((slot) => slot.prompt),
      nextActionLabel: "Collect holder address",
    }),
    audit: [
      ...baseAudit(params),
      {
        step: "holder_address_required",
        decision: "needs_input",
        detail: "No reusable certificate was found and the holder address is not known.",
      },
    ],
  };
  return {
    status: "needs_holder_address",
    policyId: params.policyId,
    holderName: params.holderName,
    workflowOutcome: outcome,
    message: workflowToolMessage(outcome),
  };
}

function certificateArtifact(data: Record<string, unknown>): WorkflowArtifact {
  return { type: "certificate_result", data };
}

function certificateSideEffect(
  generated: Record<string, unknown>,
): WorkflowSideEffect {
  if (generated.status === "existing") {
    return {
      kind: "existing_file_returned",
      targetType: "certificateVersion",
      targetId: String(generated.certificateVersionId ?? ""),
      description: "Returned an existing certificate for the current policy version.",
    };
  }
  return {
    kind: "file_generated",
    targetType: "certificate",
    targetId: String(generated.certificateId ?? ""),
    description: "Generated a certificate PDF.",
  };
}

export function certificateGeneratedOutcome(args: {
  params: CertificateRequestWorkflowParams;
  generated: Record<string, unknown>;
  attachment?: Record<string, unknown>;
  artifactData: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  const existing = args.generated.status === "existing";
  return {
    workflowKind: "certificate_request",
    status: "completed",
    nextAction: existing ? "return_existing_certificate" : "generate_certificate",
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [certificateSideEffect(args.generated)],
    artifacts: [
      certificateArtifact(args.artifactData),
      ...(args.attachment ? [{ type: "response_attachment", data: args.attachment }] : []),
    ],
    comms: workflowCommsPlan({
      headline: existing
        ? `I found an existing certificate for ${args.params.holderName} and attached it.`
        : `I generated the certificate for ${args.params.holderName} and attached it.`,
      nextActionLabel: existing ? "Return existing certificate" : "Attach generated certificate",
    }),
    audit: [
      ...baseAudit(args.params),
      {
        step: "existing_certificate_checked",
        decision: existing ? "existing_returned" : "no_reusable_certificate",
      },
      {
        step: existing ? "completed_existing_returned" : "completed_generated",
        decision: "completed",
      },
    ],
  };
}

export function certificateHeldOutcome(args: {
  params: CertificateRequestWorkflowParams;
  generated: Record<string, unknown>;
  artifactData: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  return {
    workflowKind: "certificate_request",
    status: "held",
    nextAction: "hold_for_broker_follow_up",
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [
      {
        kind: "record_created",
        targetType: "certificateRequestHold",
        targetId: String(args.generated.holdId ?? ""),
        description: "Put the certificate request on hold.",
      },
      ...(args.generated.policyChangeCaseId
        ? [
            {
              kind: "record_created" as const,
              targetType: "policyChangeCase",
              targetId: String(args.generated.policyChangeCaseId),
              description: "Opened a broker follow-up for required certificate changes.",
            },
          ]
        : []),
    ],
    artifacts: [
      { type: "certificate_hold", data: args.artifactData },
    ],
    comms: workflowCommsPlan({
      headline: String(args.generated.message ?? "This certificate needs broker review before it can be issued."),
      nextActionLabel: "Broker follow-up required",
    }),
    audit: [
      ...baseAudit(args.params),
      {
        step: "endorsement_evidence_reviewed",
        decision: "held_for_broker_follow_up",
        detail: String(args.generated.reasonCode ?? ""),
      },
    ],
  };
}

export function certificatePendingApprovalOutcome(args: {
  params: CertificateRequestWorkflowParams;
  generated: Record<string, unknown>;
  artifactData: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  return {
    workflowKind: "certificate_request",
    status: "pending_approval",
    nextAction: "request_program_approval",
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [
      {
        kind: "record_created",
        targetType: "certificateRequest",
        targetId: String(args.generated.requestId ?? ""),
        description: "Created a certified certificate approval request.",
      },
    ],
    artifacts: [{ type: "certificate_result", data: args.artifactData }],
    comms: workflowCommsPlan({
      headline: "Certified COI request created and sent to the program administrator for approval.",
      nextActionLabel: "Await approval",
    }),
    audit: [
      ...baseAudit(args.params),
      { step: "pending_program_approval", decision: "approval_requested" },
    ],
  };
}

export function certificateRecoverableOutcome(args: {
  params: CertificateRequestWorkflowParams;
  status: string;
  message: string;
  nextAction: CertificateRequestNextAction;
  artifactData?: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  return {
    workflowKind: "certificate_request",
    status: "failed_recoverably",
    nextAction: args.nextAction,
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [],
    artifacts: args.artifactData ? [{ type: "certificate_result", data: args.artifactData }] : [],
    comms: workflowCommsPlan({
      headline: args.message,
      nextActionLabel: args.status,
    }),
    audit: [
      ...baseAudit(args.params),
      { step: args.status, decision: "blocked_recoverably" },
    ],
  };
}

export function shouldCollectCertificateHolderAddress(
  params: CertificateRequestWorkflowParams,
) {
  return !hasAddress(extractHolderAddress(params));
}
