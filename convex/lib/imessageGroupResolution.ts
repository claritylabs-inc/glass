import type { Id } from "../_generated/dataModel";

export type ResolvedImessageParticipant = {
  address: string;
  displayName?: string;
  userId?: Id<"users">;
  userName?: string;
  userEmail?: string;
  orgId?: Id<"organizations">;
  role: "linked" | "anonymous";
};

export type ImessageConversationScope =
  | {
      kind: "no_linked_users";
      linkedParticipants: ResolvedImessageParticipant[];
      anonymousParticipants: ResolvedImessageParticipant[];
      orgIds: Id<"organizations">[];
      primaryOrgId?: undefined;
      primaryUserId?: undefined;
    }
  | {
      kind: "single_org";
      linkedParticipants: ResolvedImessageParticipant[];
      anonymousParticipants: ResolvedImessageParticipant[];
      orgIds: Id<"organizations">[];
      primaryOrgId: Id<"organizations">;
      primaryUserId: Id<"users">;
    }
  | {
      kind: "multi_org";
      linkedParticipants: ResolvedImessageParticipant[];
      anonymousParticipants: ResolvedImessageParticipant[];
      orgIds: Id<"organizations">[];
      primaryOrgId: Id<"organizations">;
      primaryUserId: Id<"users">;
    };

export function normalizeImessageAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const compact = trimmed.replace(/[^+\d]/g, "").replace(/(?!^)\+/g, "");
  if (!compact) return trimmed;
  return compact.startsWith("+") ? compact : `+${compact}`;
}

export function anonymousParticipantLabel(address: string, ordinal: number): string {
  const normalized = normalizeImessageAddress(address);
  const suffix = normalized.replace(/\D/g, "").slice(-4);
  if (suffix) return `Guest ${ordinal} (${suffix})`;
  return `Guest ${ordinal}`;
}

export function resolveImessageConversationScope(params: {
  senderAddress: string;
  participants: ResolvedImessageParticipant[];
}): ImessageConversationScope {
  const linked = params.participants.filter((p) => p.userId && p.orgId);
  const anonymous = params.participants.filter((p) => !p.userId || !p.orgId);
  const orgIds = [...new Set(linked.map((p) => p.orgId!))];
  if (linked.length === 0 || orgIds.length === 0) {
    return {
      kind: "no_linked_users",
      linkedParticipants: linked,
      anonymousParticipants: anonymous,
      orgIds,
    };
  }

  const senderAddress = normalizeImessageAddress(params.senderAddress);
  const sender = linked.find((p) => normalizeImessageAddress(p.address) === senderAddress);
  const primary = sender ?? linked[0]!;
  if (orgIds.length === 1) {
    return {
      kind: "single_org",
      linkedParticipants: linked,
      anonymousParticipants: anonymous,
      orgIds,
      primaryOrgId: orgIds[0]!,
      primaryUserId: primary.userId!,
    };
  }

  return {
    kind: "multi_org",
    linkedParticipants: linked,
    anonymousParticipants: anonymous,
    orgIds,
    primaryOrgId: primary.orgId!,
    primaryUserId: primary.userId!,
  };
}

export function buildImessageRosterContext(params: {
  senderAddress: string;
  participants: ResolvedImessageParticipant[];
  orgNamesById: Record<string, string>;
  scopeKind: ImessageConversationScope["kind"];
}): string {
  const senderAddress = normalizeImessageAddress(params.senderAddress);
  const lines = params.participants.map((participant, index) => {
    const label =
      participant.userName ??
      participant.displayName ??
      anonymousParticipantLabel(participant.address, index + 1);
    const current = normalizeImessageAddress(participant.address) === senderAddress
      ? " (current sender)"
      : "";
    const orgName = participant.orgId
      ? params.orgNamesById[String(participant.orgId)] ?? "linked org"
      : "not linked to a Glass org";
    return `- ${label}${current}: ${participant.address}; ${orgName}`;
  });

  return `\n\nIMESSAGE GROUP CONTEXT\nScope: ${params.scopeKind}
Participants:
${lines.join("\n")}

When this is a group chat, distinguish speakers by name. Anonymous participants can provide context, but they are not authorized members. In mixed-org groups, answer only with information that is appropriate for the linked orgs present, label org-specific context, and ask for clarification before taking write actions unless the target org and policy are unambiguous.`;
}
