"use client";

import { Mail, MessageSquare, UserPlus } from "lucide-react";
import { BrandIcon } from "@/components/ui/brand-icon";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import {
  buildAgentContactVCard,
  downloadVCard,
} from "@/components/lib/agent-contact-vcard";
import {
  AGENT_TEXT_NUMBER,
  IMESSAGE_CONTACT_ENABLED,
} from "@/lib/imessage-config";
import { AGENT_DOMAIN } from "./nav-config";
import type { BrokerContact } from "./types";

export function SidebarBrokerContact({
  broker,
  fallbackAgentHandle,
}: {
  broker: BrokerContact;
  fallbackAgentHandle?: string;
}) {
  // When no broker is linked, fall back to Glass defaults so the user still
  // sees who to contact (the standard agent email).
  const isGlassFallback = !broker;
  const name = broker?.name ?? "Ask Glass";
  const iconUrl = broker?.iconUrl ?? null;
  const brandColor = broker?.brandingColor ?? "#000000";
  const handle = broker?.agentHandle ?? fallbackAgentHandle;
  const agentEmail = handle
    ? `${handle}@${AGENT_DOMAIN}`
    : `agent@${AGENT_DOMAIN}`;
  const initial = name.charAt(0).toUpperCase();

  const handleSaveContact = async () => {
    if (!agentEmail) return;
    const { vcard, fileName } = await buildAgentContactVCard({
      broker,
      email: agentEmail,
      phone: IMESSAGE_CONTACT_ENABLED ? AGENT_TEXT_NUMBER : undefined,
    });
    downloadVCard(vcard, fileName);
  };

  return (
    <div className="py-4 px-3 space-y-4 border-t border-foreground/6">
      <div className="flex items-center gap-2.5">
        <div
          className={`h-8 w-8 shrink-0 overflow-hidden rounded-md flex items-center justify-center ${
            isGlassFallback
              ? "bg-white ring-1 ring-inset ring-foreground/10"
              : ""
          }`}
          style={
            isGlassFallback
              ? undefined
              : {
                  background: `linear-gradient(135deg, ${brandColor} 0%, ${brandColor}cc 60%, ${brandColor}88 100%)`,
                }
          }
        >
          {isGlassFallback ? (
            // Glass globe is rendered at text scale (not filling the tile)
            // because that's how the brand mark is meant to read.
            <LogoIcon size={14} static color="#000000" />
          ) : iconUrl ? (
            <BrandIcon
              src={iconUrl}
              name={name}
              size="lg"
              className="h-full w-full rounded-[inherit]"
            />
          ) : (
            <span className="text-base font-semibold text-white">
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-foreground truncate">
            {name}
          </p>
          {agentEmail ? (
            <a
              href={`mailto:${agentEmail}`}
              className="block text-label text-muted-foreground hover:text-foreground truncate"
              title={broker ? "Partner assistant" : "Glass assistant"}
            >
              {agentEmail}
            </a>
          ) : null}
        </div>
      </div>
      {agentEmail ? (
        <div className="mt-2.5 flex flex-col gap-1.5 lg:flex-row">
          <PillButton
            variant="primary"
            size="compact"
            className="hidden lg:inline-flex flex-1"
            onClick={() => {
              window.location.href = `mailto:${agentEmail}`;
            }}
          >
            <Mail className="h-3 w-3" />
            <span className="whitespace-nowrap">Email agent</span>
          </PillButton>
          {IMESSAGE_CONTACT_ENABLED ? (
            <PillButton
              variant="primary"
              size="compact"
              className="w-full lg:hidden"
              onClick={() => {
                window.location.href = `sms:${AGENT_TEXT_NUMBER}`;
              }}
            >
              <MessageSquare className="h-3 w-3" />
              <span className="whitespace-nowrap">Text My Agent</span>
            </PillButton>
          ) : null}
          <PillButton
            variant="secondary"
            size="compact"
            onClick={handleSaveContact}
            title="Save as contact"
            aria-label="Save as contact"
          >
            <UserPlus className="h-3 w-3" />
            <span className="whitespace-nowrap lg:hidden">Save contact</span>
          </PillButton>
        </div>
      ) : null}
    </div>
  );
}
