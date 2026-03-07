"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { ConnectionForm } from "@/components/connection-form";
import { ScanStatus } from "@/components/scan-status";
import { FadeIn } from "@/components/ui/fade-in";
import { CTAButton } from "@/components/ui/cta-button";
import { Mail, Trash2, Play } from "lucide-react";

export default function ConnectionsPage() {
  const connections = useQuery(api.connections.list);
  const removeConnection = useMutation(api.connections.remove);
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="!mb-1">Email Connections</h1>
                <p className="text-body-sm text-muted-foreground">
                  Connect IMAP email inboxes to scan for insurance policies
                </p>
              </div>
              <CTAButton
                label="Add Connection"
                onClick={() => setFormOpen(true)}
              />
            </div>
          </FadeIn>

          {connections && connections.length === 0 && (
            <FadeIn when={true} delay={0.2} duration={0.6}>
              <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center">
                <Mail className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-body-sm text-muted-foreground mb-1">
                  No email connections yet
                </p>
                <p className="text-label-sm text-muted-foreground/60">
                  Add an IMAP connection to start scanning for insurance
                  policies
                </p>
              </div>
            </FadeIn>
          )}

          <div className="space-y-3">
            {connections?.map((conn, i) => (
              <FadeIn
                key={conn._id}
                when={true}
                staggerIndex={i + 1}
                duration={0.6}
              >
                <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mail className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-body-sm font-medium text-foreground">
                          {conn.label}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60">
                          {conn.email} · {conn.imapHost}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <ScanStatus
                        status={conn.lastScanStatus}
                        error={conn.lastScanError}
                      />
                      {conn.emailsFound != null && (
                        <span className="text-label-sm text-muted-foreground">
                          {conn.emailsFound} emails ·{" "}
                          {conn.policiesExtracted ?? 0} policies
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          scanInbox({ connectionId: conn._id })
                        }
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        Scan
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          removeConnection({ id: conn._id })
                        }
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </main>

      <ConnectionForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
