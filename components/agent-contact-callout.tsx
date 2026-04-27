"use client";

import { Mail, MessageSquare, UserPlus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { buildAgentContactVCard, downloadVCard } from "@/components/lib/agent-contact-vcard";

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";
const AGENT_TEXT_NUMBER = "+14155909221";

interface AgentContactCalloutProps {
  /** Linked broker partner, when present. Falls back to a Glass-branded card otherwise. */
  broker?: {
    name: string;
    iconUrl?: string | null;
    whiteLabelingEnabled?: boolean;
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
  const handle = broker?.agentHandle ?? fallbackAgentHandle ?? null;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : `agent@${AGENT_DOMAIN}`;

  const handleEmail = () => {
    window.location.href = `mailto:${agentEmail}`;
  };

  const handleText = () => {
    window.location.href = `sms:${AGENT_TEXT_NUMBER}`;
  };

  const handleSaveContact = async () => {
    const { vcard, fileName } = await buildAgentContactVCard({
      broker,
      email: agentEmail,
      phone: AGENT_TEXT_NUMBER,
    });
    downloadVCard(vcard, fileName);
  };

  return (
    <div
      className={`mb-6 sm:min-h-56 flex items-stretch rounded-xl bg-card text-card-foreground border px-6 py-6 sm:px-8 sm:py-7 ${className ?? ""}`}
    >
      <div className="w-full flex flex-col gap-10 sm:gap-6 justify-between">
        <div className="min-w-0 max-w-xl">
          <div className="text-3xl sm:text-4xl font-medium tracking-tight leading-[1.1]">
            Get answers about your insurance coverage, wherever you are
            <LogoIcon className="inline -mt-0.5 ml-2.5 h-6 w-6"/>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row shrink-0 items-stretch sm:items-center gap-2 mb-1">
          <PillButton variant="primary" className="hidden sm:inline-flex" onClick={handleEmail}>
            <Mail className="h-4 w-4" />
            Email {agentEmail}
          </PillButton>
          <PillButton
            variant="secondary"
            className="hidden sm:inline-flex"
            onClick={handleText}
          >
            <MessageSquare className="h-4 w-4" />
            Text My Agent
          </PillButton>
          <PillButton variant="primary" className="sm:hidden" onClick={handleText}>
            <MessageSquare className="h-4 w-4" />
            Text My Agent
          </PillButton>
          <PillButton variant="secondary" onClick={handleSaveContact}>
            <UserPlus className="h-4 w-4" />
            Save contact
          </PillButton>
        </div>
      </div>
    </div>
  );
}
