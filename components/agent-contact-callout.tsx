"use client";

import { useState } from "react";
import { Mail, MessageSquare, UserPlus, Loader2 } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

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
  /** Optional user phone number for starting a Messages/iMessage conversation. */
  userPhone?: string | null;
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
  userPhone,
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

  const sendIntro = useAction(api.actions.sendIntroImessage.sendIntroImessage);
  const [sendingIntro, setSendingIntro] = useState(false);

  const handleEmail = () => {
    window.location.href = `mailto:${agentEmail}`;
  };

  const handleText = async () => {
    if (!userPhone) return;
    setSendingIntro(true);
    try {
      const result = await sendIntro({}) as { ok: boolean; error?: string };
      if (result.ok) {
        toast.success("Intro text sent — check your iMessages!");
      } else if (result.error === "no_phone") {
        toast.error("No phone number on file. Add one in your profile.");
      } else {
        toast.error("Couldn't send the intro text. Please try again.");
      }
    } catch {
      toast.error("Couldn't send the intro text. Please try again.");
    } finally {
      setSendingIntro(false);
    }
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
    const vcard =
      "BEGIN:VCARD\n" +
      "VERSION:3.0\n" +
      `FN:${agentDisplayName}\n` +
      `N:Agent;${name};;;\n` +
      `ORG:${name}\n` +
      `EMAIL;TYPE=INTERNET:${agentEmail}` +
      photoEntry +
      "\nEND:VCARD\n";
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

        <div className="flex shrink-0 items-center gap-2 mb-1">
          <PillButton variant="primary" onClick={handleEmail}>
            <Mail className="h-4 w-4" />
            Email {agentEmail}
          </PillButton>
          {userPhone ? (
            <PillButton
              variant="secondary"
              onClick={() => void handleText()}
              disabled={sendingIntro}
            >
              {sendingIntro ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              {sendingIntro ? "Sending…" : "Text My Agent"}
            </PillButton>
          ) : null}
          <PillButton variant="secondary" onClick={handleSaveContact}>
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:block">Save contact</span>
          </PillButton>
        </div>
      </div>
    </div>
  );
}
