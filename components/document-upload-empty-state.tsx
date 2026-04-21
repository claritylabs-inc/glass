"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Check, Copy, Forward } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

type DocumentKind = "policy" | "application";

interface DocumentUploadEmptyStateProps {
  kind: DocumentKind;
  uploading: boolean;
  onUpload: (file: File) => void | Promise<void>;
}

const COPY: Record<DocumentKind, { title: string; dropHeadline: string; dropActive: string; uploading: string; emailHint: string }> = {
  policy: {
    title: "No policies yet",
    dropHeadline: "Drag and drop a policy PDF",
    dropActive: "Drop policy PDF to upload",
    uploading: "Uploading policy...",
    emailHint: "Forward any policy email with the attachments and Glass will set it up automatically.",
  },
  application: {
    title: "No applications yet",
    dropHeadline: "Drag and drop an application PDF",
    dropActive: "Drop application PDF to upload",
    uploading: "Uploading application...",
    emailHint: "Forward any application email with the attachments and Glass will start the workflow automatically.",
  },
};

export function DocumentUploadEmptyState({ kind, uploading, onUpload }: DocumentUploadEmptyStateProps) {
  const copy = COPY[kind];
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const [copied, setCopied] = useState(false);

  const agentHandle = viewerOrg?.org?.agentHandle ?? viewer?.agentHandle;
  const agentEmail = agentHandle ? `${agentHandle}@${AGENT_DOMAIN}` : null;

  const handleCopy = () => {
    if (!agentEmail) return;
    navigator.clipboard.writeText(agentEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-foreground/6 bg-card p-6">
      <div className="mb-4">
        <p className="text-body-sm font-medium text-foreground">{copy.title}</p>
        <p className="text-label-sm text-muted-foreground mt-1">
          Email it in or drop a PDF — Glass sets it up for you, no downloads or forms to fill.
        </p>
      </div>

      {agentEmail && (
        <button
          type="button"
          onClick={handleCopy}
          className="w-full flex items-start gap-3 rounded-lg border border-foreground/6 p-3 mb-3 hover:bg-foreground/[0.02] transition-colors cursor-pointer text-left"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.04] mt-0.5">
            <Forward className="h-4 w-4 text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-body-sm font-medium text-foreground">Email or forward to your agent</p>
              <p className="text-body-sm text-muted-foreground truncate">{agentEmail}</p>
            </div>
            <p className="text-label-sm text-muted-foreground/70 mt-1">{copy.emailHint}</p>
          </div>
          {copied ? (
            <Check className="w-4 h-4 text-green-500 shrink-0 mt-1" />
          ) : (
            <Copy className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
          )}
        </button>
      )}

      <FileDropZone
        disabled={uploading}
        onFile={onUpload}
        idleLabel={copy.dropHeadline}
        activeLabel={copy.dropActive}
        busyLabel={copy.uploading}
      />
    </div>
  );
}
