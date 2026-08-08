"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Loader2, UserPlus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { InviteMemberDrawer } from "@/components/settings/invite-member-drawer";
import { TeamMemberEditDrawer } from "@/components/settings/team-member-edit-drawer";
import { TeamMembersList } from "@/components/settings/team-members-list";
import type {
  TeamInvitation,
  TeamMember,
  ViewerOrgData,
} from "@/components/settings/team-types";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type OperatorClientTeamTarget = {
  _id: Id<"organizations">;
  primaryInsuranceContactId?: Id<"users">;
  operatorStatus?: "onboarding" | "live";
};

export function TeamSection({
  operatorClient,
  setOperatorRightPanel,
  onOperatorActivationSent,
}: {
  operatorClient?: OperatorClientTeamTarget;
  setOperatorRightPanel?: (node: React.ReactNode) => void;
  onOperatorActivationSent?: () => void | Promise<void>;
} = {}) {
  const operatorClientOrgId = operatorClient?._id;
  const teamQueryArgs = useMemo(
    () => operatorClientOrgId ? { operatorClientOrgId } : {},
    [operatorClientOrgId],
  );
  const cacheScope = operatorClientOrgId ?? "current";
  const membersCacheKey = operatorClientOrgId
    ? `settings.team.listMembers.${cacheScope}`
    : "settings.team.listMembers";
  const invitationsCacheKey = operatorClientOrgId
    ? `settings.team.listInvitations.${cacheScope}`
    : "settings.team.listInvitations";
  const viewer = useCachedQuery("settings.team.viewer", api.users.viewer, {});
  const currentOrgData = useCachedViewerOrg();
  const orgData = useMemo(
    () => operatorClient
      ? {
          org: operatorClient,
          membership: { role: "admin" as const },
        }
      : currentOrgData,
    [currentOrgData, operatorClient],
  );
  const members = useCachedQuery(
    membersCacheKey,
    api.orgs.listMembers,
    teamQueryArgs,
  ) as TeamMember[] | undefined;
  const invitations = useCachedQuery(
    invitationsCacheKey,
    api.orgs.listInvitations,
    teamQueryArgs,
  ) as TeamInvitation[] | undefined;
  const updateCachedMembers = useUpdateCachedQuery<
    TeamMember[],
    { operatorClientOrgId?: Id<"organizations"> }
  >(membersCacheKey);
  const updateCachedInvitations = useUpdateCachedQuery<
    TeamInvitation[],
    { operatorClientOrgId?: Id<"organizations"> }
  >(invitationsCacheKey);
  const updateCachedViewerOrg = useUpdateCachedQuery<
    ViewerOrgData,
    Record<string, never>
  >("orgs.viewerOrg");
  const removeMember = useMutation(api.orgs.removeMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const updateMemberProfile = useMutation(api.orgs.updateMemberProfile);
  const requestMemberEmailChange = useAction(api.orgs.requestMemberEmailChange);
  const launchSoloClient = useAction(api.operator.launchSoloClient);
  const cancelMemberEmailChange = useMutation(api.orgs.cancelMemberEmailChange);
  const setPrimaryContact = useMutation(api.orgs.setPrimaryInsuranceContact);
  const ensurePrimaryContact = useMutation(
    api.orgs.ensurePrimaryInsuranceContact,
  );
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);

  const org = orgData?.org;
  const viewerUserId = viewer?._id;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<TeamMember["role"]>("member");
  const [editEmail, setEditEmail] = useState("");
  const [emailChangeError, setEmailChangeError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [cancellingEmailChange, setCancellingEmailChange] = useState(false);
  const [removingMember, setRemovingMember] = useState(false);
  const [settingPrimaryContactUserId, setSettingPrimaryContactUserId] =
    useState<Id<"users"> | null>(null);
  const [activationUserId, setActivationUserId] =
    useState<Id<"users"> | null>(null);

  const {
    setActions: setSettingsActions,
    setRightPanel: setSettingsRightPanel,
  } = useSettingsActions();
  const setRightPanel = setOperatorRightPanel ?? setSettingsRightPanel;
  const adminCount =
    members?.filter((member) => member.role === "admin").length ?? 0;
  const primaryContactId =
    org?.primaryInsuranceContactId ??
    (members?.length === 1 ? members[0]?.userId : undefined);

  const patchCachedPrimaryContact = useCallback(
    async (userId: Id<"users"> | undefined) => {
      if (operatorClientOrgId) return;
      await updateCachedViewerOrg({}, (current) =>
        current?.org
          ? {
              ...current,
              org: {
                ...current.org,
                primaryInsuranceContactId: userId,
              },
            }
          : current,
      );
    },
    [operatorClientOrgId, updateCachedViewerOrg],
  );

  const updatePrimaryContact = useCallback(
    async (userId: Id<"users">) => {
      setSettingPrimaryContactUserId(userId);
      try {
        await setPrimaryContact({ userId, operatorClientOrgId });
        await patchCachedPrimaryContact(userId);
        toast.success("Primary contact updated");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Failed to update primary contact",
          ),
        );
      } finally {
        setSettingPrimaryContactUserId(null);
      }
    },
    [operatorClientOrgId, patchCachedPrimaryContact, setPrimaryContact],
  );

  const openEditMember = useCallback((member: TeamMember) => {
    setEditingMember(member);
    setEditName(member.name ?? "");
    setEditTitle(member.title ?? "");
    setEditPhone(member.phone ?? "");
    setEditRole(member.role);
    setEditEmail("");
    setEmailChangeError("");
  }, []);

  const removeTeamMember = useCallback(
    async (member: TeamMember) => {
      setRemovingMember(true);
      try {
        const result = await removeMember({
          membershipId: member.membershipId,
          operatorClientOrgId,
        });
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.filter((row) => row.membershipId !== member.membershipId),
        );
        await patchCachedPrimaryContact(
          result.primaryInsuranceContactId ?? undefined,
        );
        toast.success("Member removed");
        setEditingMember(null);
      } catch (error) {
        toast.error(getUserFacingErrorMessage(error, "Failed to remove member"));
      } finally {
        setRemovingMember(false);
      }
    },
    [
      operatorClientOrgId,
      patchCachedPrimaryContact,
      removeMember,
      teamQueryArgs,
      updateCachedMembers,
    ],
  );

  const saveTeamMember = useCallback(
    async (member: TeamMember, roleLocked: boolean) => {
      setSavingProfile(true);
      try {
        const nextRole = roleLocked ? member.role : editRole;

        await updateMemberProfile({
          membershipId: member.membershipId,
          name: editName,
          title: editTitle,
          operatorClientOrgId,
          ...(editPhone.trim() !== (member.phone ?? "").trim()
            ? { phone: editPhone }
            : {}),
        });
        if (nextRole !== member.role) {
          await updateMemberRole({
            membershipId: member.membershipId,
            role: nextRole,
            operatorClientOrgId,
          });
        }
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? {
                  ...row,
                  name: editName.trim() || undefined,
                  title: editTitle.trim() || undefined,
                  phone: editPhone || undefined,
                  role: nextRole,
                }
              : row,
          ),
        );
        toast.success("Team member updated");
        setEditingMember(null);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to update team member"),
        );
      } finally {
        setSavingProfile(false);
      }
    },
    [
      editName,
      editPhone,
      editRole,
      editTitle,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedMembers,
      updateMemberProfile,
      updateMemberRole,
    ],
  );

  const cancelPendingEmailChange = useCallback(
    async (member: TeamMember) => {
      if (!member.pendingEmailChange) return;

      setCancellingEmailChange(true);
      setEmailChangeError("");
      try {
        await cancelMemberEmailChange({
          membershipId: member.membershipId,
          requestId: member.pendingEmailChange.requestId,
          operatorClientOrgId,
        });
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? { ...row, pendingEmailChange: undefined }
              : row,
          ),
        );
        setEditingMember((current) =>
          current?.membershipId === member.membershipId
            ? { ...current, pendingEmailChange: undefined }
            : current,
        );
        toast.success("Email change cancelled");
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to cancel email change",
        );
        setEmailChangeError(message);
        toast.error(message);
      } finally {
        setCancellingEmailChange(false);
      }
    },
    [
      cancelMemberEmailChange,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedMembers,
    ],
  );

  const requestPendingEmailChange = useCallback(
    async (member: TeamMember, email: string) => {
      const nextEmail = email.trim();
      if (!nextEmail || !viewerUserId) return;

      setRequestingEmailChange(true);
      setEmailChangeError("");
      try {
        const result = await requestMemberEmailChange({
          membershipId: member.membershipId,
          email: nextEmail,
          operatorClientOrgId,
        });
        const pendingEmailChange = {
          requestId: result.requestId,
          newEmail: result.newEmail,
          requestedAt: result.requestedAt,
          expiresAt: result.expiresAt,
          requestedByUserId: viewerUserId,
        };
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? { ...row, pendingEmailChange }
              : row,
          ),
        );
        setEditingMember((current) =>
          current?.membershipId === member.membershipId
            ? { ...current, pendingEmailChange }
            : current,
        );
        setEditEmail("");
        toast.success(`Verification code sent to ${result.newEmail}`);
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to request email change",
        );
        setEmailChangeError(message);
        toast.error(message);
      } finally {
        setRequestingEmailChange(false);
      }
    },
    [
      operatorClientOrgId,
      requestMemberEmailChange,
      teamQueryArgs,
      updateCachedMembers,
      viewerUserId,
    ],
  );

  const cancelPendingInvitation = useCallback(
    async (invitation: TeamInvitation) => {
      try {
        await cancelInvitation({
          invitationId: invitation._id,
          operatorClientOrgId,
        });
        await updateCachedInvitations(teamQueryArgs, (current) =>
          current.filter((row) => row._id !== invitation._id),
        );
        toast.success("Invitation cancelled");
      } catch {
        toast.error("Failed to cancel invitation");
      }
    },
    [
      cancelInvitation,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedInvitations,
    ],
  );

  const sendOperatorActivation = useCallback(
    async (member: TeamMember) => {
      if (!operatorClientOrgId || member.role !== "admin" || !member.email) {
        return;
      }
      setActivationUserId(member.userId);
      try {
        const result = await launchSoloClient({
          clientOrgId: operatorClientOrgId,
          adminUserId: member.userId,
        });
        await onOperatorActivationSent?.();
        toast.success(`Activation email queued for ${result.recipientEmail}`);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to send activation email"),
        );
      } finally {
        setActivationUserId(null);
      }
    },
    [launchSoloClient, onOperatorActivationSent, operatorClientOrgId],
  );

  useEffect(() => {
    if (operatorClientOrgId) return;
    setSettingsActions(
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => setInviteOpen(true)}
      >
        <UserPlus className="w-3.5 h-3.5" />
        Invite Member
      </PillButton>,
    );
    return () => setSettingsActions(null);
  }, [operatorClientOrgId, setSettingsActions]);

  useEffect(() => {
    if (orgData === undefined || members === undefined) return;
    if (org?.primaryInsuranceContactId || members.length !== 1) return;

    let cancelled = false;
    void ensurePrimaryContact({ operatorClientOrgId })
      .then(async (result) => {
        if (cancelled || !result.userId) return;
        await patchCachedPrimaryContact(result.userId);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    ensurePrimaryContact,
    members,
    operatorClientOrgId,
    org?.primaryInsuranceContactId,
    orgData,
    patchCachedPrimaryContact,
  ]);

  useEffect(() => {
    if (editingMember) {
      setRightPanel(
        <TeamMemberEditDrawer
          member={editingMember}
          viewerUserId={viewerUserId}
          adminCount={adminCount}
          primaryContactId={primaryContactId}
          name={editName}
          title={editTitle}
          phone={editPhone}
          role={editRole}
          email={editEmail}
          emailChangeError={emailChangeError}
          savingProfile={savingProfile}
          removingMember={removingMember}
          requestingEmailChange={requestingEmailChange}
          cancellingEmailChange={cancellingEmailChange}
          settingPrimaryContactUserId={settingPrimaryContactUserId}
          onOpenChange={(open) => {
            if (!open) setEditingMember(null);
          }}
          onNameChange={setEditName}
          onTitleChange={setEditTitle}
          onPhoneChange={setEditPhone}
          onRoleChange={setEditRole}
          onEmailChange={(value) => {
            setEditEmail(value);
            setEmailChangeError("");
          }}
          onSave={(member, roleLocked) =>
            void saveTeamMember(member, roleLocked)
          }
          onRemove={(member) => void removeTeamMember(member)}
          onSetPrimary={(userId) => void updatePrimaryContact(userId)}
          onRequestEmailChange={(member, email) =>
            void requestPendingEmailChange(member, email)
          }
          onCancelEmailChange={(member) =>
            void cancelPendingEmailChange(member)
          }
        />,
      );
      return () => setRightPanel(null);
    }
    setRightPanel(
      <InviteMemberDrawer
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        operatorClientOrgId={operatorClientOrgId}
      />,
    );
    return () => setRightPanel(null);
  }, [
    editName,
    editEmail,
    editRole,
    emailChangeError,
    editPhone,
    editTitle,
    editingMember,
    inviteOpen,
    operatorClientOrgId,
    adminCount,
    primaryContactId,
    cancellingEmailChange,
    removingMember,
    requestingEmailChange,
    savingProfile,
    settingPrimaryContactUserId,
    cancelPendingEmailChange,
    requestPendingEmailChange,
    saveTeamMember,
    setRightPanel,
    updatePrimaryContact,
    removeTeamMember,
    viewerUserId,
  ]);

  if (viewer === undefined || orgData === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {operatorClientOrgId ? (
        <div className="flex justify-end">
          <PillButton
            size="compact"
            variant="secondary"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="size-3.5" />
            Invite member
          </PillButton>
        </div>
      ) : null}
      <TeamMembersList
        members={members}
        invitations={invitations}
        viewerUserId={viewerUserId}
        canEditMembers={orgData?.membership?.role === "admin"}
        primaryContactId={primaryContactId}
        renderMemberAction={
          operatorClientOrgId
            ? (member) =>
                member.role === "admin" ? (
                  <PillButton
                    size="compact"
                    variant="secondary"
                    disabled={activationUserId !== null || !member.email}
                    title={
                      member.email
                        ? undefined
                        : "This admin does not have an email address"
                    }
                    onClick={() => void sendOperatorActivation(member)}
                  >
                    {activationUserId === member.userId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    {activationUserId === member.userId
                      ? "Sending…"
                      : operatorClient?.operatorStatus === "onboarding"
                        ? "Send activation"
                        : "Resend activation"}
                  </PillButton>
                ) : null
            : undefined
        }
        onEditMember={openEditMember}
        onCancelInvitation={(invitation) =>
          void cancelPendingInvitation(invitation)
        }
      />
    </div>
  );
}
