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
