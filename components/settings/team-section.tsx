"use client";

import { useState, useEffect } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  UserPlus,
  ShieldCheck,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { InviteMemberDrawer } from "@/components/settings/invite-member-drawer";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type TeamMember = {
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
type TeamInvitation = {
  _id: Id<"orgInvitations">;
  status: string;
  email: string;
  role: "admin" | "member";
  [key: string]: unknown;
};
type ViewerOrgData = {
  org?: { primaryInsuranceContactId?: Id<"users"> } & Record<string, unknown>;
  [key: string]: unknown;
} | null;

export function TeamSection() {
  const viewer = useCachedQuery("settings.team.viewer", api.users.viewer, {});
  const orgData = useCachedViewerOrg();
  const members = useCachedQuery(
    "settings.team.listMembers",
    api.orgs.listMembers,
    {},
  ) as TeamMember[] | undefined;
  const invitations = useCachedQuery(
    "settings.team.listInvitations",
    api.orgs.listInvitations,
    {},
  ) as TeamInvitation[] | undefined;
  const updateCachedMembers = useUpdateCachedQuery<
    TeamMember[],
    Record<string, never>
  >("settings.team.listMembers");
  const updateCachedInvitations = useUpdateCachedQuery<
    TeamInvitation[],
    Record<string, never>
  >("settings.team.listInvitations");
  const updateCachedViewerOrg = useUpdateCachedQuery<
    ViewerOrgData,
    Record<string, never>
  >("orgs.viewerOrg");
  const removeMember = useMutation(api.orgs.removeMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const updateMemberProfile = useMutation(api.orgs.updateMemberProfile);
  const requestMemberEmailChange = useAction(api.orgs.requestMemberEmailChange);
  const cancelMemberEmailChange = useMutation(api.orgs.cancelMemberEmailChange);
  const setPrimaryContact = useMutation(api.orgs.setPrimaryInsuranceContact);
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);

  const org = orgData?.org;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [emailChangeError, setEmailChangeError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [cancellingEmailChange, setCancellingEmailChange] = useState(false);

  const { setActions, setRightPanel } = useSettingsActions();

  useEffect(() => {
    setActions(
      <PillButton size="compact" variant="secondary" onClick={() => setInviteOpen(true)}>
        <UserPlus className="w-3.5 h-3.5" />
        Invite Member
      </PillButton>
    );
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editingMember) {
      setRightPanel(
        <SettingsDrawer
          open={!!editingMember}
          onOpenChange={(open) => {
            if (!open) setEditingMember(null);
          }}
          title="Edit team member"
          footer={
            <PillButton
              disabled={savingProfile}
              onClick={async () => {
                if (!editingMember) return;
                setSavingProfile(true);
                try {
                  await updateMemberProfile({
                    membershipId: editingMember.membershipId,
                    name: editName,
                    title: editTitle,
                    phone: editPhone,
                  });
                  await updateCachedMembers({}, (current) =>
                    current.map((member) =>
                      member.membershipId === editingMember.membershipId
                        ? {
                            ...member,
                            name: editName.trim() || undefined,
                            title: editTitle.trim() || undefined,
                            phone: editPhone || undefined,
                          }
                        : member,
                    ),
                  );
                  toast.success("Profile updated");
                  setEditingMember(null);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to update profile");
                } finally {
                  setSavingProfile(false);
                }
              }}
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save profile
            </PillButton>
          }
        >
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-label font-medium text-muted-foreground">Name</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                placeholder="Name"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-label font-medium text-muted-foreground">Title</span>
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                placeholder="Title"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-label font-medium text-muted-foreground">Phone</span>
              <PhoneInput
                value={editPhone}
                onChange={(value) => setEditPhone(value ?? "")}
                defaultCountry="US"
                placeholder="(555) 123-4567"
              />
            </label>
            <div className="space-y-3 border-t border-foreground/6 pt-4">
              <div>
                <p className="text-label font-medium text-muted-foreground">Account email</p>
                <p className="truncate text-base text-foreground">
                  {editingMember.email ?? "No email"}
                </p>
              </div>
              {editingMember.pendingEmailChange ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2">
                    <p className="text-label text-muted-foreground">Pending email</p>
                    <p className="truncate text-base font-medium text-foreground">
                      {editingMember.pendingEmailChange.newEmail}
                    </p>
                  </div>
                  <PillButton
                    variant="secondary"
                    disabled={cancellingEmailChange}
                    onClick={async () => {
                      if (!editingMember.pendingEmailChange) return;
                      setCancellingEmailChange(true);
                      setEmailChangeError("");
                      try {
                        await cancelMemberEmailChange({
                          membershipId: editingMember.membershipId,
                          requestId: editingMember.pendingEmailChange.requestId,
                        });
                        await updateCachedMembers({}, (current) =>
                          current.map((member) =>
                            member.membershipId === editingMember.membershipId
                              ? { ...member, pendingEmailChange: undefined }
                              : member,
                          ),
                        );
                        setEditingMember({
                          ...editingMember,
                          pendingEmailChange: undefined,
                        });
                        toast.success("Email change cancelled");
                      } catch (error) {
                        const message =
                          error instanceof Error
                            ? error.message
                            : "Failed to cancel email change";
                        setEmailChangeError(message);
                        toast.error(message);
                      } finally {
                        setCancellingEmailChange(false);
                      }
                    }}
                  >
                    {cancellingEmailChange ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Cancel email change
                  </PillButton>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block space-y-1.5">
                    <span className="text-label font-medium text-muted-foreground">New email</span>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(event) => {
                        setEditEmail(event.target.value);
                        setEmailChangeError("");
                      }}
                      className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      placeholder="name@example.com"
                    />
                  </label>
                  <PillButton
                    variant="secondary"
                    disabled={requestingEmailChange || !editEmail.trim()}
                    onClick={async () => {
                      if (!editEmail.trim() || !viewer?._id) return;
                      setRequestingEmailChange(true);
                      setEmailChangeError("");
                      try {
                        const result = await requestMemberEmailChange({
                          membershipId: editingMember.membershipId,
                          email: editEmail.trim(),
                        });
                        const pendingEmailChange = {
                          requestId: result.requestId,
                          newEmail: result.newEmail,
                          requestedAt: result.requestedAt,
                          expiresAt: result.expiresAt,
                          requestedByUserId: viewer._id,
                        };
                        await updateCachedMembers({}, (current) =>
                          current.map((member) =>
                            member.membershipId === editingMember.membershipId
                              ? { ...member, pendingEmailChange }
                              : member,
                          ),
                        );
                        setEditingMember({
                          ...editingMember,
                          pendingEmailChange,
                        });
                        setEditEmail("");
                        toast.success(`Verification code sent to ${result.newEmail}`);
                      } catch (error) {
                        const message =
                          error instanceof Error
                            ? error.message
                            : "Failed to request email change";
                        setEmailChangeError(message);
                        toast.error(message);
                      } finally {
                        setRequestingEmailChange(false);
                      }
                    }}
                  >
                    {requestingEmailChange ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Send verification
                  </PillButton>
                </div>
              )}
              {emailChangeError ? (
                <p className="text-label text-red-500/80">{emailChangeError}</p>
              ) : null}
            </div>
          </div>
        </SettingsDrawer>,
      );
      return () => setRightPanel(null);
    }
    setRightPanel(<InviteMemberDrawer open={inviteOpen} onOpenChange={setInviteOpen} />);
    return () => setRightPanel(null);
  }, [
    editName,
    editEmail,
    emailChangeError,
    editPhone,
    editTitle,
    editingMember,
    inviteOpen,
    cancellingEmailChange,
    requestingEmailChange,
    savingProfile,
    cancelMemberEmailChange,
    requestMemberEmailChange,
    setRightPanel,
    updateCachedMembers,
    updateMemberProfile,
    viewer,
  ]);

  if (viewer === undefined || orgData === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const adminCount = members.filter((member) => member.role === "admin").length;

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader title="Team Members" className="px-5 py-3.5" />
        <div className="divide-y divide-foreground/6">
          {members.map((member) => {
            const isLastAdmin = member.role === "admin" && adminCount <= 1;

            return (
              <OperationalItem key={member.membershipId} className="flex items-center gap-3 border-0 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center text-label font-medium text-foreground shrink-0">
                  {member.name
                    ? member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                    : member.email?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium text-foreground truncate">
                    {member.name || member.email}
                    {member.userId === viewer?._id && (
                      <span className="text-label text-muted-foreground/40 ml-1">(you)</span>
                    )}
                  </p>
                  <p className="text-label text-muted-foreground truncate">
                    {[member.name ? member.email : null, member.title, member.phone]
                      .filter(Boolean)
                      .join(" · ") || member.email}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {member.userId === org?.primaryInsuranceContactId && (
                    <span className="text-label text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                      Primary Contact
                    </span>
                  )}
                  <span className={`text-label px-1.5 py-0.5 rounded flex items-center gap-1 ${
                    member.role === "admin"
                      ? "text-primary-muted bg-primary-light/10"
                      : "text-muted-foreground bg-foreground/5"
                  }`}>
                    {member.role === "admin" && <ShieldCheck className="w-3 h-3" />}
                    {member.role === "admin" ? "Admin" : "Member"}
                  </span>
                  {orgData?.membership?.role === "admin" && (
                    <PillButton
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        setEditingMember(member);
                        setEditName(member.name ?? "");
                        setEditTitle(member.title ?? "");
                        setEditPhone(member.phone ?? "");
                        setEditEmail("");
                        setEmailChangeError("");
                      }}
                    >
                      Edit
                    </PillButton>
                  )}
                  {member.userId !== viewer?._id && (
                    <div className="flex items-center gap-1">
                      {member.userId !== org?.primaryInsuranceContactId && (
                        <PillButton
                          variant="ghost"
                          size="compact"
                          onClick={async () => {
                            try {
                              await setPrimaryContact({ userId: member.userId });
                              await updateCachedViewerOrg({}, (current) =>
                                current?.org
                                  ? {
                                      ...current,
                                      org: {
                                        ...current.org,
                                        primaryInsuranceContactId: member.userId,
                                      },
                                    }
                                  : current,
                              );
                              toast.success("Primary contact updated");
                            } catch (e: unknown) {
                              const msg = e instanceof Error ? e.message : "Failed to update";
                              toast.error(msg);
                            }
                          }}
                          title="Set as primary insurance contact"
                        >
                          Set Primary
                        </PillButton>
                      )}
                      <PillButton
                        variant="ghost"
                        size="compact"
                        disabled={isLastAdmin}
                        title={isLastAdmin ? "At least one admin is required" : undefined}
                        onClick={async () => {
                          if (isLastAdmin) return;
                          try {
                            const nextRole =
                              member.role === "admin" ? "member" : "admin";
                            await updateMemberRole({
                              membershipId: member.membershipId,
                              role: nextRole,
                            });
                            await updateCachedMembers({}, (current) =>
                              current.map((row) =>
                                row.membershipId === member.membershipId
                                  ? { ...row, role: nextRole }
                                  : row,
                              ),
                            );
                            toast.success("Role updated");
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : "Failed to update role";
                            toast.error(msg);
                          }
                        }}
                      >
                        {member.role === "admin" ? "Demote" : "Promote"}
                      </PillButton>
                      <PillButton
                        variant="destructive"
                        size="compact"
                        onClick={async () => {
                          try {
                            await removeMember({ membershipId: member.membershipId });
                            await updateCachedMembers({}, (current) =>
                              current.filter(
                                (row) => row.membershipId !== member.membershipId,
                              ),
                            );
                            toast.success("Member removed");
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : "Failed to remove member";
                            toast.error(msg);
                          }
                        }}
                      >
                        Remove
                      </PillButton>
                    </div>
                  )}
                </div>
              </OperationalItem>
            );
          })}

          {/* Pending invitations */}
          {invitations?.filter((i) => i.status === "pending").map((inv) => (
            <OperationalItem key={inv._id} className="flex items-center gap-3 border-0 px-5 py-3.5 opacity-60">
              <div className="flex-1 min-w-0">
                <p className="text-base text-muted-foreground truncate">{inv.email}</p>
                <p className="text-label text-muted-foreground/40">Invitation pending</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-label text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">
                  {inv.role}
                </span>
                <PillButton
                  variant="destructive"
                  size="compact"
                  onClick={async () => {
                    try {
                      await cancelInvitation({ invitationId: inv._id });
                      await updateCachedInvitations({}, (current) =>
                        current.filter((row) => row._id !== inv._id),
                      );
                      toast.success("Invitation cancelled");
                    } catch {
                      toast.error("Failed to cancel invitation");
                    }
                  }}
                >
                  Cancel
                </PillButton>
              </div>
            </OperationalItem>
          ))}
        </div>
      </OperationalPanel>

    </div>
  );
}
