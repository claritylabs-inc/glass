import { Plug } from "lucide-react";

const UPCOMING = [
  { key: "accounting", label: "Accounting", description: "QuickBooks, Xero, NetSuite" },
  { key: "hris", label: "HR / HRIS", description: "Rippling, Gusto, BambooHR" },
  { key: "payroll", label: "Payroll", description: "Gusto, Rippling, Deel" },
  { key: "crm", label: "CRM", description: "Salesforce, HubSpot" },
  { key: "storage", label: "Document storage", description: "Google Drive, Dropbox" },
  { key: "agency", label: "Agency management", description: "AMS360, EPIC, HawkSoft" },
];

export function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body-sm font-medium text-foreground mb-1">Integrations</h3>
        <p className="text-body-sm text-muted-foreground">
          Connect external systems to enrich your Glass data. Coming soon.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {UPCOMING.map((cat) => (
          <div
            key={cat.key}
            className="flex items-start gap-3 rounded-lg border border-foreground/6 bg-card p-4 opacity-70"
          >
            <div className="mt-0.5 w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
              <Plug className="w-4 h-4 text-muted-foreground/50" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground">{cat.label}</p>
              <p className="text-label-sm text-muted-foreground/50">{cat.description}</p>
              <p className="text-label-sm text-muted-foreground/40 mt-1">Coming soon</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
