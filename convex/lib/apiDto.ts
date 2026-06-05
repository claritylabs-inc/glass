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

export interface McpQuoteSummarySource {
  _id: DtoId;
  carrier: string;
  security?: string;
  broker?: string;
  policyTypes: string[];
  policyYear: number;
  quoteNumber?: string;
  quoteYear?: number;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  premium?: string | number;
  insuredName: string;
  summary?: string;
  isRenewal: boolean;
  coverages: Jsonish[];
}

export interface McpQuoteSummaryDto {
  _id: string;
  carrier: string;
  security?: string;
  broker?: string;
  quoteNumber?: string;
  policyTypes: string[];
  quoteYear?: number;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  premium?: string | number;
  insuredName: string;
  summary?: string;
  isRenewal: boolean;
  coverages: Jsonish[];
}

export function toMcpQuoteSummaryDto(quote: McpQuoteSummarySource): McpQuoteSummaryDto {
  return {
    _id: quote._id,
    carrier: quote.carrier,
    security: quote.security,
    broker: quote.broker,
    quoteNumber: quote.quoteNumber,
    policyTypes: quote.policyTypes,
    quoteYear: quote.quoteYear,
    proposedEffectiveDate: quote.proposedEffectiveDate,
    proposedExpirationDate: quote.proposedExpirationDate,
    quoteExpirationDate: quote.quoteExpirationDate,
    premium: quote.premium,
    insuredName: quote.insuredName,
    summary: quote.summary,
    isRenewal: quote.isRenewal,
    coverages: quote.coverages,
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
  certificateHolderId?: DtoId;
  policyVersionId?: DtoId;
  certificateVersionId?: DtoId;
  lifecycleStatus?: string;
  latestVersionNumber?: number;
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
  certificate_holder_id: string | null;
  policy_version_id: string | null;
  certificate_version_id: string | null;
  lifecycle_status: string | null;
  latest_version_number: number | null;
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
    certificate_holder_id: certificate.certificateHolderId ?? null,
    policy_version_id: certificate.policyVersionId ?? null,
    certificate_version_id: certificate.certificateVersionId ?? null,
    lifecycle_status: certificate.lifecycleStatus ?? null,
    latest_version_number: certificate.latestVersionNumber ?? null,
    disclaimer: certificate.disclaimer ?? null,
    created_at: certificate.createdAt,
    url: certificate.url ?? null,
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

export function quoteMatchesMcpFilters(
  quote: PolicyFilterSource,
  filters: Pick<PolicyFilters, "carrier" | "year">,
): boolean {
  if (filters.carrier && quote.carrier !== filters.carrier) return false;
  if (filters.year && quote.policyYear !== Number.parseInt(filters.year, 10)) return false;
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
