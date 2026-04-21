export interface OrgDto {
  id: string;
  name: string;
  created_at: number;
  industry?: string;
}

export function toOrgDto(org: any): OrgDto {
  return {
    id: org._id,
    name: org.name,
    created_at: org._creationTime,
    industry: org.industry,
  };
}

export interface PolicyDto {
  id: string;
  carrier: string;
  policy_number: string;
  policy_types: string[];
  effective_date: string;
  expiration_date: string;
  premium?: number;
  created_at: number;
}

export function toPolicyDto(policy: any): PolicyDto {
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

export interface PassportDto {
  id: string;
  legal_name?: string;
  full_time_employees?: number;
  annual_revenue?: number;
  created_at: number;
  updated_at?: number;
}

export function toPassportDto(passport: any): PassportDto {
  return {
    id: passport._id,
    legal_name: passport.legalName,
    full_time_employees: passport.fullTimeEmployees,
    annual_revenue: passport.annualRevenue,
    created_at: passport._creationTime,
    updated_at: passport.lastUpdated,
  };
}

export interface ApplicationDto {
  id: string;
  title: string;
  status: string;
  created_at: number;
  groups: {
    id: string;
    title: string;
    status: string;
    questions: {
      id: string;
      intent_key?: string;
      custom_prompt?: string;
      answer_type: string;
      required: boolean;
      answer?: any;
    }[];
  }[];
}

export function toApplicationDto(app: any): ApplicationDto {
  return {
    id: app._id,
    title: app.title,
    status: app.status,
    created_at: app._creationTime,
    groups: (app.groups || []).map((g: any) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      questions: (g.questions || []).map((q: any) => ({
        id: q.id,
        intent_key: q.intentKey,
        custom_prompt: q.customPrompt,
        answer_type: q.answerType,
        required: q.required,
        answer: q.answer,
      })),
    })),
  };
}

export interface NotificationDto {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: number;
}

export function toNotificationDto(notif: any): NotificationDto {
  return {
    id: notif._id,
    type: notif.type,
    message: notif.message,
    read: notif.read,
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
