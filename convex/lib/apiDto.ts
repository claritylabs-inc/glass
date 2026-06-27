type DtoId = string;
type Jsonish = unknown;

export interface OrgDtoSource {
  _id: DtoId;
  _creationTime: number;
  name: string;
  industry?: string;
}

export interface OrgDto {
  id: string;
  name: string;
  created_at: number;
  industry?: string;
}

export function toOrgDto(org: OrgDtoSource): OrgDto {
  return {
    id: org._id,
    name: org.name,
    created_at: org._creationTime,
    industry: org.industry,
  };
}

export interface PolicyDtoSource {
  _id: DtoId;
  _creationTime: number;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
}

export interface PolicyDto {
  id: string;
  carrier: string;
  policy_number: string;
  policy_types: string[];
  effective_date: string;
  expiration_date: string;
  premium?: string | number;
  created_at: number;
}

export function toPolicyDto(policy: PolicyDtoSource): PolicyDto {
  return {
    id: policy._id,
    carrier: policy.carrier,
    policy_number: policy.policyNumber,
    policy_types: policy.policyTypes,
    effective_date: policy.effectiveDate,
    expiration_date: policy.expirationDate,
    premium: policy.premium,
    created_at: policy._creationTime,
  };
}

export interface McpPolicySummarySource {
  _id: DtoId;
  carrier: string;
  security?: string;
  broker?: string;
  policyNumber: string;
  policyTypes: string[];
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
  insuredName: string;
  summary?: string;
  isRenewal: boolean;
  coverages: Jsonish[];
  pipelineStatus?: string;
  extractionDataStage?: "placeholder" | "preview" | "final" | string;
}

export interface McpPolicySummaryDto {
  _id: string;
  carrier: string;
  security?: string;
  broker?: string;
  policyNumber: string;
  policyTypes: string[];
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
  insuredName: string;
  summary?: string;
  isRenewal: boolean;
  coverages: Jsonish[];
  pipelineStatus?: string;
  extractionDataStage?: string;
  provisional?: boolean;
}

export function toMcpPolicySummaryDto(policy: McpPolicySummarySource): McpPolicySummaryDto {
  return {
    _id: policy._id,
    carrier: policy.carrier,
    security: policy.security,
    broker: policy.broker,
    policyNumber: policy.policyNumber,
    policyTypes: policy.policyTypes,
    policyYear: policy.policyYear,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    premium: policy.premium,
    insuredName: policy.insuredName,
    summary: policy.summary,
    isRenewal: policy.isRenewal,
    coverages: policy.coverages,
    pipelineStatus: policy.pipelineStatus,
    extractionDataStage: policy.extractionDataStage,
    provisional: policy.extractionDataStage === "preview",
  };
}

export interface McpPolicySearchResultDto {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
  insuredName: string;
  summary?: string;
  pipelineStatus?: string;
  extractionDataStage?: string;
  provisional?: boolean;
}

export function toMcpPolicySearchResultDto(
  policy: McpPolicySummarySource,
): McpPolicySearchResultDto {
  return {
    _id: policy._id,
    carrier: policy.carrier,
    policyNumber: policy.policyNumber,
    policyTypes: policy.policyTypes,
    policyYear: policy.policyYear,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    premium: policy.premium,
    insuredName: policy.insuredName,
    summary: policy.summary,
    pipelineStatus: policy.pipelineStatus,
    extractionDataStage: policy.extractionDataStage,
    provisional: policy.extractionDataStage === "preview",
  };
}

export interface McpConnectedVendorPolicyDto {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
  insuredName: string;
  pipelineStatus?: string;
  extractionDataStage?: string;
  provisional?: boolean;
}

export function toMcpConnectedVendorPolicyDto(
  policy: McpPolicySummarySource,
): McpConnectedVendorPolicyDto {
  return {
    _id: policy._id,
    carrier: policy.carrier,
    policyNumber: policy.policyNumber,
    policyTypes: policy.policyTypes,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    premium: policy.premium,
    insuredName: policy.insuredName,
    pipelineStatus: policy.pipelineStatus,
    extractionDataStage: policy.extractionDataStage,
    provisional: policy.extractionDataStage === "preview",
  };
}

export interface McpMyPolicyDto {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  effectiveDate: string;
  expirationDate: string;
  premium?: string | number;
  pipelineStatus?: string;
  extractionDataStage?: string;
  provisional?: boolean;
}

export function toMcpMyPolicyDto(policy: McpPolicySummarySource): McpMyPolicyDto {
  return {
    _id: policy._id,
    carrier: policy.carrier,
    policyNumber: policy.policyNumber,
    policyTypes: policy.policyTypes,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    premium: policy.premium,
    pipelineStatus: policy.pipelineStatus,
    extractionDataStage: policy.extractionDataStage,
    provisional: policy.extractionDataStage === "preview",
  };
}

export interface PolicyFileDtoSource {
  _id: DtoId;
  fileId?: DtoId;
  fileName?: string;
  policyNumber?: string;
}

export interface PolicyFileDto {
  id: string;
  file_id: string | undefined;
  file_name: string;
  content_type: "application/pdf";
  url: string;
}

export function toPolicyFileDto(policy: PolicyFileDtoSource, url: string): PolicyFileDto {
  return {
    id: policy._id,
    file_id: policy.fileId,
    file_name: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
    content_type: "application/pdf",
    url,
  };
}

export interface CertificateDtoSource {
  _id: DtoId;
  policyId: DtoId;
  fileId: DtoId;
  fileName: string;
  certificateHolder?: string;
  certificateHolderName?: string;
  source?: string;
  authorityType?: string;
  certificationStatus?: string;
  partnerOrgId?: DtoId;
  partnerProgramId?: DtoId;
  templateId?: DtoId;
  approvalId?: DtoId;
  standingAuthorizationId?: DtoId;
  disclaimer?: string;
  createdAt: number;
  url?: string | null;
}

export interface CertificateDto {
  id: string;
  policy_id: string;
  file_id: string;
  file_name: string;
  certificate_holder: string | null;
  certificate_holder_name: string | null;
  source: string | null;
  authority_type: string;
  certification_status: string;
  partner_org_id: string | null;
  partner_program_id: string | null;
  template_id: string | null;
  approval_id: string | null;
  standing_authorization_id: string | null;
  disclaimer: string | null;
  created_at: number;
  url: string | null;
}

export function toCertificateDto(certificate: CertificateDtoSource): CertificateDto {
  return {
    id: certificate._id,
    policy_id: certificate.policyId,
    file_id: certificate.fileId,
    file_name: certificate.fileName,
    certificate_holder: certificate.certificateHolder ?? null,
    certificate_holder_name: certificate.certificateHolderName ?? null,
    source: certificate.source ?? null,
    authority_type: certificate.authorityType ?? "non_binding",
    certification_status: certificate.certificationStatus ?? "not_applicable",
    partner_org_id: certificate.partnerOrgId ?? null,
    partner_program_id: certificate.partnerProgramId ?? null,
    template_id: certificate.templateId ?? null,
    approval_id: certificate.approvalId ?? null,
    standing_authorization_id: certificate.standingAuthorizationId ?? null,
    disclaimer: certificate.disclaimer ?? null,
    created_at: certificate.createdAt,
    url: certificate.url ?? null,
  };
}

export interface CertificateHolderDtoSource {
  _id: DtoId;
  orgId: DtoId;
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    formatted?: string;
  };
  normalizedName?: string;
  normalizedEmail?: string;
  normalizedAddressKey?: string;
  mapboxFeatureId?: string;
  source?: string;
  sourceRef?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export function toCertificateHolderDto(holder: CertificateHolderDtoSource) {
  return {
    id: holder._id,
    org_id: holder.orgId,
    display_name: holder.displayName,
    contact_name: holder.contactName ?? null,
    email: holder.email ?? null,
    phone: holder.phone ?? null,
    address: holder.address ?? null,
    normalized_name: holder.normalizedName ?? null,
    normalized_email: holder.normalizedEmail ?? null,
    normalized_address_key: holder.normalizedAddressKey ?? null,
    mapbox_feature_id: holder.mapboxFeatureId ?? null,
    source: holder.source ?? null,
    source_ref: holder.sourceRef ?? null,
    notes: holder.notes ?? null,
    created_at: holder.createdAt,
    updated_at: holder.updatedAt,
  };
}

export interface PolicyVersionDtoSource {
  _id: DtoId;
  orgId: DtoId;
  policyId: DtoId;
  versionNumber: number;
  versionKind: string;
  effectiveDate?: string;
  expirationDate?: string;
  policyNumber?: string;
  sourcePolicyFileIds?: DtoId[];
  sourceFileIds?: DtoId[];
  caseId?: DtoId;
  extractionRunId?: DtoId;
  snapshot?: Jsonish;
  fieldDiffs?: Jsonish[];
  summary?: string;
  createdAt: number;
}

export function toPolicyVersionDto(version: PolicyVersionDtoSource) {
  return {
    id: version._id,
    org_id: version.orgId,
    policy_id: version.policyId,
    version_number: version.versionNumber,
    version_kind: version.versionKind,
    effective_date: version.effectiveDate ?? null,
    expiration_date: version.expirationDate ?? null,
    policy_number: version.policyNumber ?? null,
    source_policy_file_ids: version.sourcePolicyFileIds ?? [],
    source_file_ids: version.sourceFileIds ?? [],
    case_id: version.caseId ?? null,
    extraction_run_id: version.extractionRunId ?? null,
    snapshot: version.snapshot ?? null,
    field_diffs: version.fieldDiffs ?? [],
    summary: version.summary ?? null,
    created_at: version.createdAt,
  };
}

export interface CertificateVersionDtoSource {
  _id: DtoId;
  orgId: DtoId;
  certificateId: DtoId;
  holderId: DtoId;
  policyId: DtoId;
  policyVersionId?: DtoId;
  versionNumber: number;
  status: string;
  fileId?: DtoId;
  fileName?: string;
  fileSize?: number;
  certificateHolder?: string;
  certificateHolderName?: string;
  holderSnapshot?: Jsonish;
  source?: string;
  authorityType?: string;
  certificationStatus?: string;
  partnerOrgId?: DtoId;
  partnerProgramId?: DtoId;
  templateId?: DtoId;
  standingAuthorizationId?: DtoId;
  approvalId?: DtoId;
  issuedAt?: number;
  supersededAt?: number;
  voidedAt?: number;
  createdAt: number;
  updatedAt: number;
  holder?: CertificateHolderDtoSource | null;
  url?: string | null;
}

export function toCertificateVersionDto(version: CertificateVersionDtoSource) {
  const holderSnapshot = version.holderSnapshot &&
    typeof version.holderSnapshot === "object" &&
    !Array.isArray(version.holderSnapshot)
    ? version.holderSnapshot as { contactName?: unknown }
    : {};
  const contactName = version.holder?.contactName ??
    (typeof holderSnapshot.contactName === "string" ? holderSnapshot.contactName : undefined);
  return {
    id: version._id,
    org_id: version.orgId,
    certificate_id: version.certificateId,
    policy_certificate_id: version.certificateId,
    holder_id: version.holderId,
    policy_id: version.policyId,
    policy_version_id: version.policyVersionId ?? null,
    version_number: version.versionNumber,
    status: version.status,
    file_id: version.fileId ?? null,
    file_name: version.fileName ?? null,
    file_size: version.fileSize ?? null,
    certificate_holder: version.certificateHolder ?? null,
    certificate_holder_name: version.certificateHolderName ?? null,
    contact_name: contactName ?? null,
    holder_snapshot: version.holderSnapshot ?? null,
    holder: version.holder ? toCertificateHolderDto(version.holder) : null,
    source: version.source ?? null,
    authority_type: version.authorityType ?? "non_binding",
    certification_status: version.certificationStatus ?? "not_applicable",
    partner_org_id: version.partnerOrgId ?? null,
    partner_program_id: version.partnerProgramId ?? null,
    template_id: version.templateId ?? null,
    standing_authorization_id: version.standingAuthorizationId ?? null,
    approval_id: version.approvalId ?? null,
    issued_at: version.issuedAt ?? null,
    superseded_at: version.supersededAt ?? null,
    voided_at: version.voidedAt ?? null,
    created_at: version.createdAt,
    updated_at: version.updatedAt,
    url: version.url ?? null,
  };
}

export interface CertificateWorkflowJobDtoSource {
  _id: DtoId;
  orgId: DtoId;
  brokerOrgId?: DtoId;
  certificateId: DtoId;
  certificateVersionId?: DtoId;
  holderId: DtoId;
  policyId: DtoId;
  policyVersionId?: DtoId;
  kind: string;
  status: string;
  reason?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  reviewNotes?: string;
  sendNotes?: string;
  sentAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  lastError?: string;
  reviewedAt?: number;
  createdAt: number;
  updatedAt: number;
  holder?: CertificateHolderDtoSource | null;
  policy?: PolicyDtoSource | null;
  certificateVersion?: CertificateVersionDtoSource | null;
}

export function toCertificateWorkflowJobDto(job: CertificateWorkflowJobDtoSource) {
  return {
    id: job._id,
    org_id: job.orgId,
    broker_org_id: job.brokerOrgId ?? null,
    certificate_id: job.certificateId,
    policy_certificate_id: job.certificateId,
    certificate_version_id: job.certificateVersionId ?? null,
    holder_id: job.holderId,
    policy_id: job.policyId,
    policy_version_id: job.policyVersionId ?? null,
    kind: job.kind,
    status: job.status,
    reason: job.reason ?? null,
    recipient_name: job.recipientName ?? null,
    recipient_email: job.recipientEmail ?? null,
    recipient_phone: job.recipientPhone ?? null,
    review_notes: job.reviewNotes ?? null,
    send_notes: job.sendNotes ?? null,
    sent_at: job.sentAt ?? null,
    cancelled_at: job.cancelledAt ?? null,
    cancel_reason: job.cancelReason ?? null,
    last_error: job.lastError ?? null,
    reviewed_at: job.reviewedAt ?? null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    holder: job.holder ? toCertificateHolderDto(job.holder) : null,
    policy: job.policy ? toPolicyDto(job.policy) : null,
    certificate_version: job.certificateVersion
      ? toCertificateVersionDto(job.certificateVersion)
      : null,
  };
}

export interface McpThreadSummarySource {
  _id: DtoId;
  title: string;
  lastMessageAt: number;
  archivedAt?: number;
  _creationTime: number;
}

export interface McpThreadSummaryDto {
  _id: string;
  title: string;
  lastMessageAt: number;
  archivedAt?: number;
  _creationTime: number;
}

export function toMcpThreadSummaryDto(thread: McpThreadSummarySource): McpThreadSummaryDto {
  return {
    _id: thread._id,
    title: thread.title,
    lastMessageAt: thread.lastMessageAt,
    archivedAt: thread.archivedAt,
    _creationTime: thread._creationTime,
  };
}

export interface McpThreadMessageSource {
  _id: DtoId;
  role: string;
  channel: string;
  content: string;
  userName?: string;
  fromEmail?: string;
  _creationTime: number;
}

export interface McpThreadMessageDto {
  _id: string;
  role: string;
  channel: string;
  content: string;
  userName?: string;
  fromEmail?: string;
  _creationTime: number;
}

export function toMcpThreadMessageDto(message: McpThreadMessageSource): McpThreadMessageDto {
  return {
    _id: message._id,
    role: message.role,
    channel: message.channel,
    content: message.content,
    userName: message.userName,
    fromEmail: message.fromEmail,
    _creationTime: message._creationTime,
  };
}

export interface NotificationDtoSource {
  _id: DtoId;
  _creationTime: number;
  type: string;
  message?: string;
  body?: string;
  read?: boolean;
}

export interface NotificationDto {
  id: string;
  type: string;
  message: string | undefined;
  read: boolean;
  created_at: number;
}

export function toNotificationDto(notif: NotificationDtoSource): NotificationDto {
  return {
    id: notif._id,
    type: notif.type,
    message: notif.message ?? notif.body,
    read: !!notif.read,
    created_at: notif._creationTime,
  };
}

export interface PaginationDto<T> {
  data: T[];
  next_cursor?: string;
}

export function toPaginationDto<T>(
  data: T[],
  nextCursor?: string,
): PaginationDto<T> {
  return {
    data,
    ...(nextCursor && { next_cursor: nextCursor }),
  };
}

export interface PolicyFilterSource {
  carrier: string;
  policyTypes?: string[];
  policyYear: number;
}

export interface PolicyFilters {
  carrier?: string | null;
  year?: string | null;
  type?: string | null;
}

export function policyMatchesMcpFilters(
  policy: PolicyFilterSource,
  filters: PolicyFilters,
): boolean {
  if (filters.carrier && policy.carrier !== filters.carrier) return false;
  if (filters.year && policy.policyYear !== Number.parseInt(filters.year, 10)) return false;
  if (filters.type && !(policy.policyTypes ?? []).includes(filters.type)) return false;
  return true;
}

export interface PolicySearchSource {
  carrier?: string;
  policyNumber?: string;
  insuredName?: string;
  summary?: string;
  security?: string;
  broker?: string;
  policyTypes?: string[];
}

export function policyMatchesSearch(policy: PolicySearchSource, query: string): boolean {
  const searchable = [
    policy.carrier,
    policy.policyNumber,
    policy.insuredName,
    policy.summary,
    policy.security,
    policy.broker,
    ...(policy.policyTypes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.includes(query.toLowerCase());
}

export interface PolicyStatsSource {
  carrier: string;
  policyTypes?: string[];
  policyYear: number;
}

export interface PolicyStatsDto {
  totalPolicies: number;
  byType: Record<string, number>;
  byCarrier: Record<string, number>;
  byYear: Record<string, number>;
}

export function toPolicyStatsDto(policies: PolicyStatsSource[]): PolicyStatsDto {
  const byType: Record<string, number> = {};
  const byCarrier: Record<string, number> = {};
  const byYear: Record<string, number> = {};

  for (const policy of policies) {
    const types = policy.policyTypes ?? ["other"];
    for (const type of types) {
      byType[type] = (byType[type] || 0) + 1;
    }
    byCarrier[policy.carrier] = (byCarrier[policy.carrier] || 0) + 1;
    byYear[policy.policyYear] = (byYear[policy.policyYear] || 0) + 1;
  }

  return {
    totalPolicies: policies.length,
    byType,
    byCarrier,
    byYear,
  };
}
