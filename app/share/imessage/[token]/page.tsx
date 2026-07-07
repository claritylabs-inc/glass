import type { Metadata } from "next";
import Image from "next/image";
import { FileText } from "lucide-react";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { CoverageBreakdownCards } from "@/app/policies/[id]/policy-coverage-breakdown";
import {
  formatDate,
  loadAppCardView,
  metadataDescription,
  type Policy,
} from "./view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await loadAppCardView(token).catch(() => null);
  if (!view) return { title: { absolute: "Glass" } };
  const description = metadataDescription(view);
  const image = `/share/imessage/${token}/opengraph-image`;
  return {
    title: { absolute: view.title },
    description,
    openGraph: {
      title: view.title,
      description,
      siteName: "Glass",
      type: "website",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: view.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: view.title,
      description,
      images: [image],
    },
  };
}

function policyPeriod(policy: Policy) {
  const effective = formatDate(policy.effectiveDate);
  const expiration = formatDate(policy.expirationDate);
  if (effective === "Not listed" && expiration === "Not listed") {
    return "Not listed";
  }
  return `${effective} to ${expiration}`;
}

function GlassWordmark() {
  return (
    <div className="flex items-center gap-2.5 text-base font-medium tracking-tight text-foreground">
      <Image src="/glass-icon.svg" alt="" width={16} height={16} />
      <span>Glass</span>
    </div>
  );
}

function PolicyPanel({ policy }: { policy: Policy }) {
  const coverageBreakdown =
    policy.coverageBreakdown ?? buildCoverageBreakdown(policy);

  return (
    <section className="space-y-5 py-7">
      <OperationalLabelValueList>
        <OperationalLabelValueRow label="Named insured" value={policy.insuredName} />
        <OperationalLabelValueRow label="Carrier" value={policy.carrier ?? "Not listed"} />
        <OperationalLabelValueRow label="Policy number" value={policy.policyNumber} />
        <OperationalLabelValueRow
          label="Type"
          value={policy.policyTypes.join(", ") || "Not listed"}
        />
        <OperationalLabelValueRow label="Policy period" value={policyPeriod(policy)} />
      </OperationalLabelValueList>

      <CoverageBreakdownCards breakdown={coverageBreakdown} />
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-base font-normal text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-base text-foreground">{value}</div>
    </div>
  );
}

export default async function ImessageSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadAppCardView(token).catch(() => null);

  if (!view) {
    return (
      <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
        <div className="mx-auto max-w-3xl">
          <GlassWordmark />
          <h1 className="mt-5 text-base font-medium tracking-normal">
            Link unavailable
          </h1>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            This shared record could not be found.
          </p>
        </div>
      </main>
    );
  }

  const rawLabel = view.label?.trim();
  const label =
    rawLabel && !rawLabel.toLowerCase().endsWith(" details") ? rawLabel : null;

  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-border pb-7">
          <div className="flex items-center justify-between gap-4">
            <GlassWordmark />
            <p className="truncate text-base text-muted-foreground">{view.orgName}</p>
          </div>
          <div className="mt-8 flex max-w-3xl flex-col items-start gap-3">
            <div className="min-w-0">
              <h1 className="text-base font-medium leading-5 tracking-normal text-foreground">
                {view.title}
              </h1>
              {view.subtitle ? (
                <p className="mt-2 text-base leading-6 text-muted-foreground">
                  {view.subtitle}
                </p>
              ) : null}
              {label ? (
                <p className="mt-3 text-base text-muted-foreground">{label}</p>
              ) : null}
            </div>
            {view.policy ? (
              <PillButton
                href={`/policies/${view.policy.id}`}
                size="compact"
                className="w-fit"
              >
                <FileText className="h-3.5 w-3.5" />
                Open full policy
              </PillButton>
            ) : null}
          </div>
        </header>

        {view.certificate ? (
          <section className="border-b border-border py-7">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div>
                <h2 className="text-base font-medium tracking-normal text-foreground">
                  Certificate
                </h2>
                <p className="mt-1 text-base text-muted-foreground">
                  {view.certificate.holderName}
                </p>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info label="Issued" value={formatDate(view.certificate.createdAt)} />
                  <Info
                    label="Version"
                    value={view.certificate.versionNumber ? String(view.certificate.versionNumber) : "Not listed"}
                  />
                </div>
                {view.certificate.fileUrl ? (
                  <div>
                    <PillButton
                      href={view.certificate.fileUrl}
                      variant="secondary"
                      className="w-fit"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open PDF
                    </PillButton>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {view.policy ? <PolicyPanel policy={view.policy} /> : null}
      </div>
    </main>
  );
}
