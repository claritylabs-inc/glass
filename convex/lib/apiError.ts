export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "insufficient_scope"
  | "rate_limited"
  | "not_found"
  | "bad_request"
  | "internal_error"
  | "conflict";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    request_id: string;
  };
}

export interface ApiErrorResponse extends ApiError {
  status: number;
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  status: number,
): ApiErrorResponse {
  return {
    status,
    error: { code, message, request_id: requestId },
  };
}

export function buildApiAuthError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
): ApiErrorResponse {
  const statusMap: Record<ApiErrorCode, number> = {
    unauthorized: 401,
    forbidden: 403,
    insufficient_scope: 403,
    rate_limited: 429,
    not_found: 404,
    bad_request: 400,
    internal_error: 500,
    conflict: 409,
  };
  return apiError(code, message, requestId, statusMap[code]);
}
