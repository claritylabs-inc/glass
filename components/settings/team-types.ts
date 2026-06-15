import type { Id } from "@/convex/_generated/dataModel";

export type TeamMember = {
  membershipId: Id<"orgMemberships">;
  userId: Id<"users">;
  role: "admin" | "member";
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
  pendingEmailChange?: {
    requestId: Id<"userEmailChangeRequests">;
    newEmail: string;
    requestedAt: number;
    expiresAt: number;
    requestedByUserId: Id<"users">;
  };
};

export type TeamInvitation = {
  _id: Id<"orgInvitations">;
  status: string;
  email: string;
  role: "admin" | "member";
  [key: string]: unknown;
};

export type ViewerOrgData = {
  org?: { primaryInsuranceContactId?: Id<"users"> } & Record<string, unknown>;
  [key: string]: unknown;
} | null;
