"use client";

import { Globe } from "lucide-react";

interface BrokerContactCardProps {
  broker: {
    name: string;
    website?: string;
    brandingColor?: string;
    agentHandle?: string;
    agentDisplayName?: string;
    iconUrl: string | null;
    primaryContact: {
      userId: string;
      name?: string;
      email?: string;
      title?: string;
    } | null;
  };
}

export function BrokerContactCard({ broker }: BrokerContactCardProps) {
  const agentDomain = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";
  const agentEmail = broker.agentHandle ? `${broker.agentHandle}@${agentDomain}` : null;
  const brandColor = broker.brandingColor ?? "#1e293b";
  const initial = broker.name.charAt(0).toUpperCase();

  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden mb-6">
      <div className="px-5 py-4 flex items-center gap-4">
        <div
          className="h-14 w-14 shrink-0 overflow-hidden rounded-xl flex items-center justify-center ring-1 ring-inset ring-white/10 shadow-sm"
          style={{
            background: `linear-gradient(135deg, ${brandColor} 0%, ${brandColor}cc 60%, ${brandColor}88 100%)`,
          }}
        >
          {broker.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={broker.iconUrl} alt={broker.name} className="h-full w-full object-contain p-1.5" />
          ) : (
            <span
              className="text-2xl font-semibold tracking-tight text-white"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
            >
              {initial}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-foreground truncate">{broker.name}</div>
          {broker.website ? (
            <a
              href={broker.website.startsWith("http") ? broker.website : `https://${broker.website}`}
              target="_blank"
              rel="noreferrer"
              className="text-label-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Globe className="w-3 h-3" />
              <span className="truncate">{broker.website.replace(/^https?:\/\//, "")}</span>
            </a>
          ) : null}
        </div>
      </div>

      {(broker.primaryContact || agentEmail) && (
        <div className="border-t border-foreground/6 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:gap-8 gap-3">
          {broker.primaryContact ? (
            <div className="min-w-0">
              <div className="text-label-sm text-muted-foreground mb-0.5">Your broker</div>
              <div className="text-body-sm font-medium text-foreground truncate">
                {broker.primaryContact.name ?? "Contact"}
                {broker.primaryContact.title ? (
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    {broker.primaryContact.title}
                  </span>
                ) : null}
              </div>
              {broker.primaryContact.email ? (
                <a
                  href={`mailto:${broker.primaryContact.email}`}
                  className="text-label-sm text-muted-foreground hover:text-foreground truncate block"
                >
                  {broker.primaryContact.email}
                </a>
              ) : null}
            </div>
          ) : null}

          {agentEmail ? (
            <div className="min-w-0">
              <div className="text-label-sm text-muted-foreground mb-0.5">Assistant</div>
              <a
                href={`mailto:${agentEmail}`}
                className="text-body-sm font-medium text-foreground hover:underline truncate block break-all"
              >
                {agentEmail}
              </a>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
