"use client";

import { Mail, MessageSquare, UserPlus } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import {
  buildAgentContactVCard,
  downloadVCard,
} from "@/components/lib/agent-contact-vcard";
import {
  AGENT_TEXT_NUMBER,
  AGENT_TEXT_NUMBER_DISPLAY,
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
  const primaryContact = broker?.primaryContact ?? null;
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
    <div className="border-t border-foreground/6 px-3 py-3">
      <div className="rounded-lg border border-foreground/6 bg-card px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`h-8 w-8 shrink-0 overflow-hidden rounded-md flex items-center justify-center ${
              isGlassFallback
                ? "bg-white ring-1 ring-inset ring-foreground/10"
                : "ring-1 ring-inset ring-white/10"
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                className="h-full w-full object-contain bg-white"
              />
            ) : (
              <span className="text-sm font-semibold text-white">
                {initial}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-medium text-foreground truncate">
              {name}
            </p>
            {primaryContact?.name ? (
              <p className="text-label-sm text-muted-foreground truncate">
                {primaryContact.name}
              </p>
            ) : null}
          </div>
        </div>
        {(primaryContact?.email || agentEmail) && (
          <div className="mt-2 space-y-1">
            {primaryContact?.email ? (
              <a
                href={`mailto:${primaryContact.email}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
              >
                {primaryContact.email}
              </a>
            ) : null}
            {primaryContact?.phone ? (
              <a
                href={`tel:${primaryContact.phone}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
              >
                {primaryContact.phone}
              </a>
            ) : null}
            {agentEmail ? (
              <a
                href={`mailto:${agentEmail}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
                title={broker ? "Partner assistant" : "Glass assistant"}
              >
                {agentEmail}
              </a>
            ) : null}
            {IMESSAGE_CONTACT_ENABLED ? (
              <a
                href={`sms:${AGENT_TEXT_NUMBER}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
              >
                {AGENT_TEXT_NUMBER_DISPLAY}
              </a>
            ) : null}
          </div>
        )}
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
    </div>
  );
}
