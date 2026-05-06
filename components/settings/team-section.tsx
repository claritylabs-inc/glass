"use client";

import { useState, useEffect } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Loader2,
  UserPlus,
  ShieldCheck,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { InviteMemberDrawer } from "@/components/settings/invite-member-drawer";

export function TeamSection() {
  const viewer = useQuery(api.users.viewer);
  const orgData = useQuery(api.orgs.viewerOrg, {});
  const members = useQuery(api.orgs.listMembers);
  const invitations = useQuery(api.orgs.listInvitations);
  const removeMember = useMutation(api.orgs.removeMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const setPrimaryContact = useMutation(api.orgs.setPrimaryInsuranceContact);
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);

  const org = orgData?.org;

  const [inviteOpen, setInviteOpen] = useState(false);

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
    setRightPanel(<InviteMemberDrawer open={inviteOpen} onOpenChange={setInviteOpen} />);
    return () => setRightPanel(null);
  }, [inviteOpen, setRightPanel]);

  if (viewer === undefined || orgData === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Team Members</h3>
        </div>
        <div className="divide-y divide-foreground/6">
          {members.map((member) => (
            <div key={member.membershipId} className="px-5 py-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center text-label-sm font-medium text-foreground shrink-0">
                {member.name
                  ? member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                  : member.email?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-medium text-foreground truncate">
                  {member.name || member.email}
                  {member.userId === viewer?._id && (
                    <span className="text-label-sm text-muted-foreground/40 ml-1">(you)</span>
                  )}
                </p>
                {member.name && member.email && (
                  <p className="text-label-sm text-muted-foreground truncate">{member.email}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {member.userId === org?.primaryInsuranceContactId && (
                  <span className="text-label-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                    Primary Contact
                  </span>
                )}
                <span className={`text-label-sm px-1.5 py-0.5 rounded flex items-center gap-1 ${
                  member.role === "admin"
                    ? "text-primary-muted bg-primary-light/10"
                    : "text-muted-foreground bg-foreground/5"
                }`}>
                  {member.role === "admin" && <ShieldCheck className="w-3 h-3" />}
                  {member.role === "admin" ? "Admin" : "Member"}
                </span>
                {member.userId !== viewer?._id && (
                  <div className="flex items-center gap-1">
                    {member.userId !== org?.primaryInsuranceContactId && (
                      <PillButton
                        variant="ghost"
                        size="compact"
                        onClick={async () => {
                          try {
                            await setPrimaryContact({ userId: member.userId });
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
                      onClick={async () => {
                        try {
                          await updateMemberRole({
                            membershipId: member.membershipId,
                            role: member.role === "admin" ? "member" : "admin",
                          });
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
            </div>
          ))}

          {/* Pending invitations */}
          {invitations?.filter((i) => i.status === "pending").map((inv) => (
            <div key={inv._id} className="px-5 py-3.5 flex items-center gap-3 opacity-60">
              <div className="flex-1 min-w-0">
                <p className="text-body-sm text-muted-foreground truncate">{inv.email}</p>
                <p className="text-label-sm text-muted-foreground/40">Invitation pending</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-label-sm text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">
                  {inv.role}
                </span>
                <PillButton
                  variant="destructive"
                  size="compact"
                  onClick={async () => {
                    try {
                      await cancelInvitation({ invitationId: inv._id });
                      toast.success("Invitation cancelled");
                    } catch {
                      toast.error("Failed to cancel invitation");
                    }
                  }}
                >
                  Cancel
                </PillButton>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
