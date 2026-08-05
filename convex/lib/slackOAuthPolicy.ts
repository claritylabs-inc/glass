export const SLACK_CUSTOMER_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "files:read",
  "files:write",
  "users:read",
] as const;

export const SLACK_HOST_SCOPES = [
  ...SLACK_CUSTOMER_SCOPES,
  "groups:write",
  "conversations.connect:write",
] as const;

export function missingSlackCustomerScopes(grantedScopes: readonly string[]) {
  const granted = new Set(grantedScopes);
  return SLACK_CUSTOMER_SCOPES.filter((scope) => !granted.has(scope));
}

export function missingSlackHostScopes(grantedScopes: readonly string[]) {
  const granted = new Set(grantedScopes);
  return SLACK_HOST_SCOPES.filter((scope) => !granted.has(scope));
}
