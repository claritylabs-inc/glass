"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";

function parseAliases(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ProgramAdminOnboardingPage() {
  const router = useRouter();
  const createPartnerOrg = useMutation(api.orgs.createPartnerOrg);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [programName, setProgramName] = useState("");
  const [aliases, setAliases] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createPartnerOrg({
        name: name.trim(),
        website: website.trim() || undefined,
        programName: programName.trim() || name.trim(),
        aliases: parseAliases(aliases),
      });
      router.replace("/partner/approvals");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create program administrator workspace");
      setSubmitting(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title="Set up your program administrator workspace"
        subtitle="Create the approval workspace MGAs use to certify COIs and approve policy changes."
        logo={<BrandWordmark />}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-foreground/8 bg-popover p-3">
            <div className="flex items-center gap-2 text-base font-medium text-foreground">
              <ShieldCheck className="h-4 w-4" />
              Program authority
            </div>
            <p className="mt-1 text-label text-muted-foreground">
              Glass matches policies to this program through MGA, carrier, underwriter and insurer aliases.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-label font-medium text-muted-foreground">
              Organization name
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Program Administrators"
              required
              autoFocus
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/8"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-label font-medium text-muted-foreground">
              Website
            </label>
            <input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/8"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-label font-medium text-muted-foreground">
              Program name
            </label>
            <input
              value={programName}
              onChange={(event) => setProgramName(event.target.value)}
              placeholder="Use organization name"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/8"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-label font-medium text-muted-foreground">
              Matching aliases
            </label>
            <input
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder="CFC, CFC Tech, Lloyd's Coverholder"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/8"
            />
          </div>

          <PillButton
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full justify-center text-base shadow-none sm:w-auto"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "Creating workspace..." : "Create workspace"}
          </PillButton>
        </form>
      </AuthCard>
    </AuthMinimalShell>
  );
}
