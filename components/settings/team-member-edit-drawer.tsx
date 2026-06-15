"use client";

import { Loader2, Mail } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import type { TeamMember } from "@/components/settings/team-types";

type TeamMemberEditDrawerProps = {
  member: TeamMember;
  viewerUserId?: Id<"users">;
  adminCount: number;
  primaryContactId?: Id<"users">;
  name: string;
  title: string;
  phone: string;
  role: TeamMember["role"];
  email: string;
  emailChangeError: string;
  savingProfile: boolean;
  removingMember: boolean;
  requestingEmailChange: boolean;
  cancellingEmailChange: boolean;
  settingPrimaryContactUserId: Id<"users"> | null;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onRoleChange: (value: TeamMember["role"]) => void;
  onEmailChange: (value: string) => void;
  onSave: (member: TeamMember, roleLocked: boolean) => void;
  onRemove: (member: TeamMember) => void;
  onSetPrimary: (userId: Id<"users">) => void;
  onRequestEmailChange: (member: TeamMember, email: string) => void;
  onCancelEmailChange: (member: TeamMember) => void;
};

export function TeamMemberEditDrawer({
  member,
  viewerUserId,
  adminCount,
  primaryContactId,
  name,
  title,
  phone,
  role,
  email,
  emailChangeError,
  savingProfile,
  removingMember,
  requestingEmailChange,
  cancellingEmailChange,
  settingPrimaryContactUserId,
  onOpenChange,
  onNameChange,
  onTitleChange,
  onPhoneChange,
  onRoleChange,
  onEmailChange,
  onSave,
  onRemove,
  onSetPrimary,
  onRequestEmailChange,
  onCancelEmailChange,
}: TeamMemberEditDrawerProps) {
  const isPrimaryContact = member.userId === primaryContactId;
  const isSelf = member.userId === viewerUserId;
  const isLastAdmin = member.role === "admin" && adminCount <= 1;
  const roleLocked = isSelf || isLastAdmin;
  const roleSelectTitle = isSelf
    ? "You cannot change your own role"
    : isLastAdmin
      ? "At least one admin is required"
      : undefined;

  return (
    <SettingsDrawer
      open
      onOpenChange={onOpenChange}
      title="Edit team member"
      footer={
        <>
          {!isSelf && !isLastAdmin ? (
            <PillButton
              variant="destructive"
              size="compact"
              disabled={removingMember}
              onClick={() => onRemove(member)}
            >
              {removingMember ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Remove team member
            </PillButton>
          ) : null}
          <PillButton
            disabled={savingProfile || removingMember}
            onClick={() => onSave(member, roleLocked)}
          >
            {savingProfile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save team member
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-label font-medium text-muted-foreground">
            Name
          </span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
            placeholder="Name"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-label font-medium text-muted-foreground">
            Title
          </span>
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
            placeholder="Title"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-label font-medium text-muted-foreground">
            Phone
          </span>
          <PhoneInput
            value={phone}
            onChange={(value) => onPhoneChange(value ?? "")}
            defaultCountry="US"
            placeholder="(555) 123-4567"
          />
        </label>
        <div className="space-y-1.5">
          <span className="text-label font-medium text-muted-foreground">
            Role
          </span>
          <Select
            value={role}
            onValueChange={(value) => {
              if (value === "admin" || value === "member") onRoleChange(value);
            }}
          >
            <SelectTrigger
              className="w-full border-foreground/8 bg-popover"
              disabled={roleLocked}
              title={roleSelectTitle}
            >
              <SelectValue>
                {role === "admin" ? "Admin" : "Member"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border border-foreground/8 bg-popover px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-medium">Primary contact</p>
              <p className="text-base text-muted-foreground">
                Used as the org&apos;s insurance contact for routing and
                follow-up.
              </p>
            </div>
            {isPrimaryContact ? (
              <Badge variant="secondary" className="mt-0.5">
                Primary Contact
              </Badge>
            ) : (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={settingPrimaryContactUserId === member.userId}
                onClick={() => onSetPrimary(member.userId)}
              >
                {settingPrimaryContactUserId === member.userId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Set primary
              </PillButton>
            )}
          </div>
        </div>
        <div className="space-y-3 border-t border-foreground/6 pt-4">
          <p className="text-base font-medium text-foreground">
            Account email
          </p>
          <div className="rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2">
            <p className="text-label text-muted-foreground">Current email</p>
            <p className="truncate text-base font-medium text-foreground">
              {member.email ?? "No email"}
            </p>
          </div>
          {member.pendingEmailChange ? (
            <div className="rounded-lg border border-foreground/8 bg-popover px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-label text-muted-foreground">
                    Pending email
                  </p>
                  <p className="truncate text-base font-medium text-foreground">
                    {member.pendingEmailChange.newEmail}
                  </p>
                </div>
                <PillButton
                  variant="secondary"
                  size="compact"
                  disabled={cancellingEmailChange}
                  onClick={() => onCancelEmailChange(member)}
                >
                  {cancellingEmailChange ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Cancel
                </PillButton>
              </div>
              <p className="mt-2 text-base text-muted-foreground">
                Waiting for verification before this replaces the current email.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="block space-y-1.5">
                <span className="text-label font-medium text-muted-foreground">
                  New email
                </span>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    placeholder="new@example.com"
                  />
                  <PillButton
                    variant="secondary"
                    className="h-10 w-full px-4 sm:w-auto"
                    disabled={requestingEmailChange || !email.trim()}
                    onClick={() => onRequestEmailChange(member, email)}
                  >
                    {requestingEmailChange ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Send code
                  </PillButton>
                </div>
              </label>
              <p className="text-base text-muted-foreground">
                The current email stays active until the new address is
                verified.
              </p>
            </div>
          )}
          {emailChangeError ? (
            <p className="text-base text-red-500/80">{emailChangeError}</p>
          ) : null}
        </div>
      </div>
    </SettingsDrawer>
  );
}
