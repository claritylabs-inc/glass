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
