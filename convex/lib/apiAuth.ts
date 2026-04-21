import { Id } from "../_generated/dataModel";

export type Scope = "read" | "write";

export interface AuthenticatedRequest {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  scopes: Scope[];
  tokenId: Id<"oauthTokens">;
  requestId: string;
}

export function parseScopesFromToken(
  scopes: string[] | null | undefined,
): Scope[] {
  if (!scopes || scopes.length === 0) {
    return ["read"];
  }
  return scopes.filter((s): s is Scope => s === "read" || s === "write");
}

export function assertScope(scopes: Scope[], required: Scope): void {
  if (!scopes.includes(required)) {
    throw new Error(`insufficient_scope: need ${required}`);
  }
}
