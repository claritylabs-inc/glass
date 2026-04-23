// Startup-oriented integrations that surface key insurance-relevant signals
// (revenue, headcount, infrastructure, engineering exposure).
const UPCOMING: {
  key: string;
  label: string;
  description: string;
  logo: string;
}[] = [
  {
    key: "stripe",
    label: "Stripe",
    description: "Revenue + payment volume for coverage sizing",
    logo: "https://cdn.simpleicons.org/stripe/635BFF",
  },
  {
    key: "quickbooks",
    label: "QuickBooks",
    description: "Financials + vendor exposure",
    logo: "https://cdn.simpleicons.org/quickbooks/2CA01C",
  },
  {
    key: "rippling",
    label: "Rippling",
    description: "Headcount + payroll for WC, EPLI, benefits",
    logo: "https://cdn.simpleicons.org/rippling",
  },
  {
    key: "aws",
    label: "AWS",
    description: "Cloud footprint for cyber underwriting",
    logo: "https://cdn.simpleicons.org/amazonwebservices/FF9900",
  },
  {
    key: "github",
    label: "GitHub",
    description: "Engineering + open-source exposure",
    logo: "https://cdn.simpleicons.org/github/181717",
  },
  {
    key: "google-workspace",
    label: "Google Workspace",
    description: "Identity, email, and document access",
    logo: "https://cdn.simpleicons.org/googleworkspace/4285F4",
  },
];

export function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body-sm font-medium text-foreground mb-1">Integrations</h3>
        <p className="text-body-sm text-muted-foreground">
          Connect the systems where your company data lives. We use them to keep
          your insurance profile accurate without the paperwork. Coming soon.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {UPCOMING.map((cat) => (
          <div
            key={cat.key}
            className="flex items-start gap-3 rounded-lg border border-foreground/6 bg-card p-4 opacity-80"
          >
            <div className="mt-0.5 w-9 h-9 rounded-lg bg-foreground/[0.03] border border-foreground/6 flex items-center justify-center shrink-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cat.logo}
                alt={`${cat.label} logo`}
                width={20}
                height={20}
                className="w-5 h-5 object-contain"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground">{cat.label}</p>
              <p className="text-label-sm text-muted-foreground/60 mt-0.5 leading-snug">
                {cat.description}
              </p>
              <p className="text-label-sm text-muted-foreground/40 mt-1.5">Coming soon</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
