"use client";

import { Mail, MessageSquare, UserPlus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";
const AGENT_TEXT_NUMBER = "+14155909221";

interface AgentContactCalloutProps {
  /** Linked broker partner, when present. Falls back to a Glass-branded card otherwise. */
  broker?: {
    name: string;
    iconUrl?: string | null;
    agentHandle?: string;
    agentDisplayName?: string;
  } | null;
  /** Optional client-org agentHandle to use when no broker is linked. */
  fallbackAgentHandle?: string | null;
  /** Optional className to merge on the outer card. */
  className?: string;
}

/**
 * Bold, full-width call-out card encouraging clients to email their agent and
 * save the contact to their device's address book. Uses `--brand` /
 * `--brand-foreground` tokens so it automatically inverts in dark mode and
 * picks up the broker's brand color when one is set (via BrandThemeApplier).
 */
export function AgentContactCallout({
  broker,
  fallbackAgentHandle,
  className,
}: AgentContactCalloutProps) {
  const name = broker?.name ?? "Glass";
  const iconUrl = broker?.iconUrl ?? null;
  const handle = broker?.agentHandle ?? fallbackAgentHandle ?? null;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : `agent@${AGENT_DOMAIN}`;
  const agentDisplayName = broker?.agentDisplayName
    ? broker.agentDisplayName
    : broker
      ? `${broker.name} Agent`
      : "Glass Agent";

  const handleEmail = () => {
    window.location.href = `mailto:${agentEmail}`;
  };

  const handleText = () => {
    window.location.href = `sms:${AGENT_TEXT_NUMBER}`;
  };

  const handleSaveContact = async () => {
    let photoEntry = "";
    // Glass fallback uses an inline SVG — skip the PHOTO entry rather than try
    // to fetch a raster asset.
    if (iconUrl) {
      try {
        const res = await fetch(iconUrl);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const s = reader.result as string;
            resolve(s.split(",")[1] ?? "");
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const mime = blob.type || "image/png";
        const type = mime.split("/")[1]?.toUpperCase() ?? "PNG";
        if (base64) photoEntry = `\nPHOTO;ENCODING=b;TYPE=${type}:${base64}`;
      } catch {
        // best-effort — omit photo on fetch failure
      }
    }
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${agentDisplayName}`,
      `N:Agent;${name};;;`,
      `ORG:${name}`,
      `EMAIL;TYPE=INTERNET:${agentEmail}`,
      `TEL;TYPE=CELL,VOICE,pref:${AGENT_TEXT_NUMBER}`,
    ];
    if (photoEntry) lines.push(photoEntry.replace(/^\n/, ""));
    lines.push("END:VCARD");
    const vcard = lines.join("\r\n") + "\r\n";
    const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${agentDisplayName}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`mb-6 sm:min-h-56 flex items-stretch rounded-xl bg-card text-card-foreground border px-6 py-6 sm:px-8 sm:py-7 ${className ?? ""}`}
    >
      <div className="w-full flex flex-col gap-6 justify-between">
        <div className="min-w-0 max-w-xl">
          <div className="text-3xl sm:text-4xl font-medium tracking-tight leading-[1.1]">
            Get answers about your insurance coverage, wherever you are
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:shrink-0 sm:items-center gap-2 mb-1">
          <PillButton
            variant="primary"
            onClick={handleEmail}
            className="w-full sm:w-auto"
          >
            <Mail className="h-4 w-4 shrink-0" />
            <span className="truncate">Email {agentEmail}</span>
          </PillButton>
          <PillButton
            variant="secondary"
            onClick={handleText}
            className="w-full sm:w-auto"
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            Text My Agent
          </PillButton>
          <PillButton
            variant="secondary"
            onClick={handleSaveContact}
            className="w-full sm:w-auto"
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            Save contact
          </PillButton>
        </div>
      </div>
    </div>
  );
}
