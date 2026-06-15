"use client";

import { Loader2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import type {
  TeamInvitation,
  TeamMember,
} from "@/components/settings/team-types";

type TeamMembersListProps = {
  members: TeamMember[];
  invitations?: TeamInvitation[];
  viewerUserId?: Id<"users">;
  canEditMembers: boolean;
  primaryContactId?: Id<"users">;
  settingPrimaryContactUserId: Id<"users"> | null;
  onEditMember: (member: TeamMember) => void;
  onSetPrimary: (userId: Id<"users">) => void;
  onCancelInvitation: (invitation: TeamInvitation) => void;
};

export function TeamMembersList({
  members,
  invitations,
  viewerUserId,
  canEditMembers,
  primaryContactId,
  settingPrimaryContactUserId,
  onEditMember,
  onSetPrimary,
  onCancelInvitation,
}: TeamMembersListProps) {
  const pendingInvitations =
    invitations?.filter((invitation) => invitation.status === "pending") ?? [];

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Team Members" className="px-5 py-3.5" />
      <div className="divide-y divide-foreground/6">
        {members.map((member) => (
          <OperationalItem
            key={member.membershipId}
            className="flex items-center gap-3 border-0 px-5 py-3.5"
          >
            <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center text-label font-medium text-foreground shrink-0">
              {getMemberInitials(member)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex gap-3">
                <p className="text-base font-medium text-foreground truncate">
                  {member.name || member.email}
                  {member.userId === viewerUserId ? (
                    <span className="text-label text-muted-foreground/40 ml-1">
                      (you)
                    </span>
                  ) : null}
                </p>
                <div className="flex gap-1">
                  {member.userId === primaryContactId ? (
                    <Badge variant="secondary">Primary Contact</Badge>
                  ) : null}
                  <Badge variant="outline">
                    {member.role === "admin" ? "Admin" : "Member"}
                  </Badge>
                </div>
              </div>
              <p className="text-label text-muted-foreground truncate">
                {[
                  member.name ? member.email : null,
                  member.title,
                  member.phone,
                ]
                  .filter(Boolean)
                  .join(" · ") || member.email}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canEditMembers ? (
                <PillButton
                  variant="secondary"
                  size="compact"
                  onClick={() => onEditMember(member)}
                >
                  Edit Team Member
                </PillButton>
              ) : null}
              {member.userId !== viewerUserId &&
              member.userId !== primaryContactId ? (
                <PillButton
                  variant="ghost"
                  size="compact"
                  disabled={settingPrimaryContactUserId === member.userId}
                  onClick={() => onSetPrimary(member.userId)}
                  title="Set as primary insurance contact"
                >
                  {settingPrimaryContactUserId === member.userId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Set Primary
                </PillButton>
              ) : null}
            </div>
          </OperationalItem>
        ))}

        {pendingInvitations.map((invitation) => (
          <OperationalItem
            key={invitation._id}
            className="flex items-center gap-3 border-0 px-5 py-3.5 opacity-60"
          >
            <div className="flex-1 min-w-0">
              <p className="text-base text-muted-foreground truncate">
                {invitation.email}
              </p>
              <p className="text-label text-muted-foreground/40">
                Invitation pending
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline">{invitation.role}</Badge>
              <PillButton
                variant="destructive"
                size="compact"
                onClick={() => onCancelInvitation(invitation)}
              >
                Cancel
              </PillButton>
            </div>
          </OperationalItem>
        ))}
      </div>
    </OperationalPanel>
  );
}

function getMemberInitials(member: TeamMember) {
  if (!member.name) return member.email?.[0]?.toUpperCase() ?? "?";

  return member.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
