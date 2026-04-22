"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Loader2, Mail, Trash2 } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { api as _api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { ConnectionForm } from "@/components/connection-form";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

type EmailConnection = {
  _id: Id<"emailConnections">;
  provider: "google" | "imap";
  email: string;
  label?: string;
  lastScanStatus?: "scanning" | "success" | "error" | "disconnected";
};

export function SectionContextEmail() {
  const router = useRouter();
  const connections = useQuery(api.connections.list, {}) as EmailConnection[] | undefined;
  const createOAuthState = useMutation(api.connections.createOAuthStateForViewer);
  const removeConnection = useMutation(api.connections.remove);

  const [showForm, setShowForm] = useState<"choose" | "imap" | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const hasConnections = (connections?.length ?? 0) > 0;

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    try {
      const sinceDate = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
      const state = crypto.randomUUID();
      await createOAuthState({
        state,
        sinceDate,
        returnTo: "/onboarding/passport/email",
      });
      window.open(
        `/api/auth/google/start?state=${encodeURIComponent(state)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start Google connection");
    } finally {
      setConnectingGoogle(false);
    }
  }

  async function handleRemove(id: Id<"emailConnections">) {
    setRemovingId(id);
    try {
      await removeConnection({ id });
    } catch {
      toast.error("Failed to remove connection");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {connections === undefined ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : connections.length > 0 ? (
        <ul className="divide-y divide-foreground/4 rounded-lg border border-foreground/8 overflow-hidden">
          {connections.map((conn) => (
            <li key={conn._id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.04] shrink-0">
                {conn.provider === "google" ? (
                  <FaGoogle className="h-3.5 w-3.5 text-foreground/70" />
                ) : (
                  <Mail className="h-3.5 w-3.5 text-foreground/70" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{conn.label || conn.email}</p>
                {conn.label && conn.label !== conn.email ? (
                  <p className="text-xs text-muted-foreground truncate">{conn.email}</p>
                ) : null}
              </div>
              {conn.lastScanStatus === "scanning" ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Scanning
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleRemove(conn._id)}
                disabled={removingId === conn._id}
                className="p-1 text-muted-foreground/50 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleConnectGoogle}
          disabled={connectingGoogle}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {connectingGoogle ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FaGoogle className="h-4 w-4" />
          )}
          {hasConnections ? "Add another Gmail account" : "Connect Gmail account"}
        </button>
        <button
          type="button"
          onClick={() => setShowForm("imap")}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-foreground/8 bg-popover px-4 py-3 text-sm font-medium text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-colors"
        >
          <Mail className="h-4 w-4" />
          {hasConnections ? "Add another IMAP account" : "Connect IMAP account"}
        </button>
      </div>

      <div className="flex flex-col items-start gap-3 pt-2">
        <PillButton
          type="button"
          onClick={() => router.push("/onboarding/passport/integrations")}
          disabled={!hasConnections}
          className="w-full justify-center text-sm shadow-none sm:w-auto"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </PillButton>
        {!hasConnections ? (
          <button
            type="button"
            onClick={() => router.push("/onboarding/passport/integrations")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        ) : null}
      </div>

      <ConnectionForm
        open={showForm !== null}
        onClose={() => setShowForm(null)}
        initialStep={showForm === "imap" ? "imap" : "choose"}
        returnTo="/onboarding/passport/email"
      />
    </div>
  );
}
