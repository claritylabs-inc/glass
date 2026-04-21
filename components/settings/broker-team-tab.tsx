"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function BrokerTeamTab() {
  const members = useQuery(api.orgs.listMembers);
  const invitations = useQuery(api.orgs.listInvitations);
  const inviteMember = useMutation(api.orgs.inviteMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    setSending(true);
    try {
      await inviteMember({ email, role });
      toast.success(`Invite sent to ${email}`);
      setEmail("");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-lg font-semibold">Team</h2>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Members</h3>
        <div className="rounded-lg border bg-card divide-y">
          {members === undefined ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
          ) : (
            members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.name ?? m.email}</p>
                  {m.name && (
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  )}
                </div>
                <Badge variant={m.role === "admin" ? "default" : "outline"}>
                  {m.role}
                </Badge>
              </div>
            ))
          )}
        </div>
      </div>

      {invitations && invitations.filter((i) => i.status === "pending").length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Pending invites</h3>
          <div className="rounded-lg border bg-card divide-y">
            {invitations
              .filter((i) => i.status === "pending")
              .map((inv) => (
                <div key={inv._id} className="flex items-center gap-3 px-4 py-3">
                  <p className="flex-1 text-sm text-muted-foreground">{inv.email}</p>
                  <Badge variant="outline">{inv.role}</Badge>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Invite a team member</h3>
        <form onSubmit={handleInvite} className="flex gap-2">
          <Input
            type="email"
            required
            placeholder="colleague@brokerage.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="border rounded-md px-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={sending}>
            {sending ? "Sending…" : "Invite"}
          </Button>
        </form>
      </div>
    </div>
  );
}
