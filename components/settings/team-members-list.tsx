"use client";

import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  onEditMember: (member: TeamMember) => void;
  onCancelInvitation: (invitation: TeamInvitation) => void;
};

export function TeamMembersList({
  members,
  invitations,
  viewerUserId,
  canEditMembers,
  primaryContactId,
  onEditMember,
  onCancelInvitation,
}: TeamMembersListProps) {
  const pendingInvitations =
    invitations?.filter((invitation) => invitation.status === "pending") ?? [];

  return (
    <OperationalPanel>
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[30%] px-5">Member</TableHead>
            <TableHead className="w-[28%]">Email</TableHead>
            <TableHead className="w-[20%]">Phone</TableHead>
            <TableHead className="w-[22%] px-5">Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow
              key={member.membershipId}
              aria-label={
                canEditMembers
                  ? `Edit ${member.name || member.email || "team member"}`
                  : undefined
              }
              className={
                canEditMembers
                  ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  : undefined
              }
              onClick={
                canEditMembers ? () => onEditMember(member) : undefined
              }
              onKeyDown={
                canEditMembers
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onEditMember(member);
                    }
                  : undefined
              }
              tabIndex={canEditMembers ? 0 : undefined}
            >
              <TableCell className="px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-label font-medium text-foreground">
                    {getMemberInitials(member)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {member.name || member.email}
                      {member.userId === viewerUserId ? (
                        <span className="ml-1 text-label font-normal text-muted-foreground/50">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    {member.title ? (
                      <p className="truncate text-label text-muted-foreground">
                        {member.title}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate py-3 text-muted-foreground">
                {member.email || "-"}
              </TableCell>
              <TableCell className="py-3 text-muted-foreground">
                {formatTeamMemberPhone(member.phone)}
              </TableCell>
              <TableCell className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline">
                    {member.role === "admin" ? "Admin" : "Member"}
                  </Badge>
                  {member.userId === primaryContactId ? (
                    <Badge variant="secondary">Primary Contact</Badge>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}

          {pendingInvitations.map((invitation) => (
            <TableRow key={invitation._id} className="opacity-60">
              <TableCell className="px-5 py-3">
                <p className="font-medium text-foreground">
                  Pending invitation
                </p>
              </TableCell>
              <TableCell className="py-3 text-muted-foreground">
                {invitation.email}
              </TableCell>
              <TableCell className="py-3 text-muted-foreground">-</TableCell>
              <TableCell className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="capitalize">
                    {invitation.role}
                  </Badge>
                  <PillButton
                    variant="destructive"
                    size="compact"
                    onClick={() => onCancelInvitation(invitation)}
                  >
                    Cancel
                  </PillButton>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

export function formatTeamMemberPhone(value?: string) {
  const phone = value?.trim();
  if (!phone) return "-";

  const parsed = parsePhoneNumberFromString(phone, "US");
  if (!parsed) return phone;

  return parsed.countryCallingCode === "1"
    ? parsed.formatNational()
    : parsed.formatInternational();
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
