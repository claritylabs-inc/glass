"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import {
  SiQuickbooks,
  SiGusto,
  SiBrex,
  SiStripe,
  SiShopify,
  SiXero,
  SiSalesforce,
  SiHubspot,
  SiSlack,
  SiNotion,
} from "react-icons/si";

/* ── Brand logos for integrations without react-icons ── */
function RipplingLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 21" fill="currentColor">
      <path
        d="M3.45 5.99c0-2.38-1.2-4.35-3.45-6h5.23a7.51 7.51 0 0 1 2.96 5.99 7.51 7.51 0 0 1-2.96 5.99c1.7.71 2.66 2.44 2.66 4.91v4.71H4.73v-4.71c0-2.36-1.12-4.01-3.16-4.91C3.83 4.31 5.03 2.34 3.45 5.99zm10.26 0c0-2.38-1.2-4.35-3.45-6h5.23a7.51 7.51 0 0 1 2.96 5.99 7.51 7.51 0 0 1-2.96 5.99c1.7.71 2.66 2.44 2.66 4.91v4.71h-4.74v-4.71c0-2.36-1.12-4.01-3.16-4.91 2.25-1.65 3.46-3.62 3.46-5.99zm10.27 0c0-2.38-1.2-4.35-3.45-6H24a7.51 7.51 0 0 1 0 11.98c1.7.71 2.66 2.44 2.66 4.91v4.71h-4.74v-4.71c0-2.36-1.12-4.01-3.16-4.91 2.25-1.65 3.46-3.62 3.46-5.99z"
        transform="scale(0.88)"
      />
    </svg>
  );
}

function DeelLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 75 72" fill="currentColor">
      <path d="m23.86 71.96c-4.56 0-8.64-1.12-12.22-3.35-3.59-2.23-6.42-5.28-8.51-9.16C1.04 55.57 0 51.18 0 46.25c0-4.92 1.04-9.29 3.13-13.1 2.09-3.87 4.92-6.89 8.51-9.06 3.59-2.23 7.66-3.35 12.22-3.35 3.65 0 6.85.69 9.58 2.07 2.19 1.1 4.05 2.57 5.58 4.39.35.41 1.07.18 1.07-.36V3.93c0-.26.18-.48.44-.54L51.95.02c.34-.07.66.19.66.54v69.68a.55.55 0 0 1-.55.55H41.91a.55.55 0 0 1-.54-.44l-1.04-5.31c-.09-.47-.71-.61-1.01-.24-1.46 1.76-3.29 3.33-5.49 4.72-2.54 1.64-5.87 2.46-9.98 2.46zm2.64-11.03c4.04 0 7.34-1.35 9.88-4.04 2.61-2.76 3.91-6.27 3.91-10.54s-1.3-7.75-3.91-10.44c-2.54-2.76-5.84-4.14-9.88-4.14-3.98 0-7.27 1.35-9.88 4.04-2.61 2.69-3.91 6.17-3.91 10.44s1.3 7.78 3.91 10.54 5.9 4.14 9.88 4.14z" />
      <circle cx="66.45" cy="62.09" r="8.43" />
    </svg>
  );
}

function CartaLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="currentColor">
      <rect x="0" y="0" width="24" height="24" rx="2" fillOpacity="0" />
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="600"
        fontFamily="system-ui"
        fill="currentColor"
      >
        carta
      </text>
    </svg>
  );
}

function MercuryLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 32 32" fill="currentColor">
      <path d="M16 0C7.19 0 .02 7.14 0 15.94v.07C0 24.84 7.19 32 16 32s16-7.19 16-15.99C32 7.16 24.83 0 16 0zm0 1.93a14.02 14.02 0 0 1 13.07 19.08c-.88.74-1.99 1.16-3.17 1.16-1.35 0-2.61-.43-3.62-1.18.51-.51.94-1.09 1.29-1.73a3.18 3.18 0 0 0 2.33.97 3.09 3.09 0 0 0 0-6.18c-1.16 0-2.22.67-2.75 1.7-.48-.87-1.13-1.62-1.89-2.2a5.12 5.12 0 0 1 4.64-3.42c.07 0 .14 0 .21.01A14.03 14.03 0 0 0 16 1.93zm-4.01 2.2a5.1 5.1 0 0 1-2.1 4.13 7.83 7.83 0 0 0-3.84 2.34A5.1 5.1 0 0 1 1.93 16a14.03 14.03 0 0 1 10.06-11.87zM16 12.2a3.79 3.79 0 1 1 0 7.58 3.79 3.79 0 0 1 0-7.58zm-9.9 1.83A3.09 3.09 0 1 0 6.1 17.9a3.1 3.1 0 0 0 2.75-1.7c.49.87 1.14 1.62 1.9 2.2a5.12 5.12 0 0 1-4.65 3.42h-.21A14.03 14.03 0 0 0 16 30.07 14.03 14.03 0 0 1 2.93 11C3.81 10.26 4.92 9.84 6.1 9.84c1.35 0 2.61.44 3.63 1.18-.52.51-.95 1.09-1.3 1.73a3.17 3.17 0 0 0-2.33-.97v.24zm13.91 11.84A5.1 5.1 0 0 1 22.1 21.73a7.83 7.83 0 0 0 3.84-2.34A5.1 5.1 0 0 1 30.07 16a14.03 14.03 0 0 1-10.06 11.87z" />
    </svg>
  );
}

const INTEGRATIONS: {
  name: string;
  desc: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}[] = [
  { name: "QuickBooks", desc: "Revenue, payroll, financials", icon: SiQuickbooks as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Xero", desc: "Accounting, invoices", icon: SiXero as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Gusto", desc: "Employee count, payroll", icon: SiGusto as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Rippling", desc: "HR, headcount, benefits", icon: RipplingLogo },
  { name: "Deel", desc: "Global workforce, contractors", icon: DeelLogo },
  { name: "Stripe", desc: "Revenue, payment volume", icon: SiStripe as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Brex", desc: "Spend data, corporate cards", icon: SiBrex as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Mercury", desc: "Banking, transactions", icon: MercuryLogo },
  { name: "Carta", desc: "Cap table, entity structure", icon: CartaLogo },
  { name: "Shopify", desc: "E-commerce, sales data", icon: SiShopify as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Salesforce", desc: "CRM, revenue pipeline", icon: SiSalesforce as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "HubSpot", desc: "CRM, customer data", icon: SiHubspot as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Slack", desc: "Team comms, notifications", icon: SiSlack as React.ComponentType<React.SVGProps<SVGSVGElement>> },
  { name: "Notion", desc: "Docs, company wiki", icon: SiNotion as React.ComponentType<React.SVGProps<SVGSVGElement>> },
];

export function IntegrationsSection() {
  const [integrationRequest, setIntegrationRequest] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3">
          <h3 className="text-body-sm font-medium text-foreground !mb-0">
            Integrations
          </h3>
          <p className="text-label-sm text-muted-foreground/60">
            Connect your tools to automatically sync business context
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {INTEGRATIONS.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setIntegrationRequest(item.name)}
              className="group/int rounded-lg border border-foreground/6 bg-card px-4 py-3 flex items-center gap-3 text-left hover:border-primary/30 hover:bg-primary/[0.02] transition-all cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                <item.icon className="w-4 h-4 text-muted-foreground/60" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-medium text-foreground">
                  {item.name}
                </p>
                <p className="text-label-sm text-muted-foreground/50 truncate">
                  {item.desc}
                </p>
              </div>
              <span className="text-label-sm font-medium text-muted-foreground/40 bg-foreground/[0.04] group-hover/int:bg-primary/10 group-hover/int:text-primary px-2 py-0.5 rounded-full shrink-0 transition-colors">
                Soon
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Integration request modal */}
      <Dialog
        open={!!integrationRequest}
        onOpenChange={(v) => !v && setIntegrationRequest(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="overflow-hidden !p-0 !gap-0"
        >
          {/* Hero header with dot matrix bg */}
          <div className="relative px-6 py-8 overflow-hidden">
            <div className="absolute inset-0">
              <img
                src="/sf-hero.webp"
                alt=""
                className="w-full h-full object-cover scale-110 blur-[6px]"
              />
              <div className="absolute inset-0 bg-black/30" />
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 400 200"
                preserveAspectRatio="xMidYMid slice"
              >
                {Array.from({ length: 15 }).flatMap((_, row) =>
                  Array.from({ length: 30 }).map((_, col) => (
                    <circle
                      key={`${row}-${col}`}
                      cx={col * 14}
                      cy={row * 14}
                      r={0.6}
                      fill={`rgba(255,255,255,${0.1 + (row / 15) * 0.4})`}
                    />
                  ))
                )}
              </svg>
            </div>
            <div className="relative flex items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <LogoIcon size={24} color="#ffffff" static />
              </div>
              <div className="flex items-center gap-1">
                <div className="w-6 h-px bg-white/30" />
                <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
                <div className="w-6 h-px bg-white/30" />
              </div>
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                {(() => {
                  const integration = INTEGRATIONS.find(
                    (i) => i.name === integrationRequest
                  );
                  if (!integration) return null;
                  const Icon = integration.icon;
                  return <Icon className="w-5 h-5 text-white" />;
                })()}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <DialogHeader className="!mb-0">
              <DialogTitle>{integrationRequest} integration</DialogTitle>
              <DialogDescription>
                The {integrationRequest} integration is coming soon. Request
                early access and we&apos;ll notify you when it&apos;s ready.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6 !-mx-6 !-mb-6 !px-6 !pb-6 [&>*]:w-full [&>*]:sm:w-auto">
              <PillButton
                variant="secondary"
                onClick={() => setIntegrationRequest(null)}
                className="w-full sm:w-auto"
              >
                Cancel
              </PillButton>
              <a
                href={`mailto:hello@claritylabs.inc?subject=Early access: ${integrationRequest} integration&body=Hi, I'd like early access to the ${integrationRequest} integration on Prism.`}
                onClick={() => {
                  setIntegrationRequest(null);
                  toast.success("Opening email — thanks for your interest!");
                }}
                className="w-full sm:w-auto"
              >
                <PillButton className="w-full sm:w-auto">
                  <Mail className="w-3 h-3" />
                  Request Early Access
                </PillButton>
              </a>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
