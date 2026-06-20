import type { Metadata } from "next";
import dayjs from "dayjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const dynamic = "force-dynamic";

type Policy = {
  title: string;
  insuredName: string;
  carrier?: string;
  policyNumber: string;
  policyTypes: string[];
  effectiveDate: string;
  expirationDate: string;
  dataStage?: string;
  coverages: Array<{
    name: string;
    limit?: string;
    deductible?: string;
    origin?: string;
  }>;
};

type AppCardView = {
  kind: "policy" | "certificate" | "certificate_request" | "policy_change";
  orgName: string;
  title: string;
  subtitle?: string;
  label?: string;
  policy?: Policy | null;
  certificate?: {
    holderName: string;
    fileName: string;
    fileUrl?: string | null;
    authorityType?: string;
    certificationStatus?: string;
    versionNumber?: number;
    createdAt: number;
  };
  certificateRequest?: {
    holderName: string;
    status: string;
    partnerName?: string;
    createdAt: number;
    updatedAt: number;
  };
  policyChange?: {
    status: string;
    requestText?: string;
    summary?: string;
    pendingQuestions: string[];
    createdAt: number;
    updatedAt: number;
  };
};

async function loadView(token: string): Promise<AppCardView | null> {
  return await fetchQuery(api.appCardLinks.getByToken, { token }) as AppCardView | null;
}

function formatDate(value?: string | number) {
  if (!value) return "Not listed";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : String(value);
}

function labelForStatus(status?: string) {
  if (!status) return "Not listed";
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await loadView(token).catch(() => null);
  if (!view) return { title: { absolute: "Glass" } };
  return {
    title: { absolute: view.title },
    description: view.subtitle ?? view.orgName,
    openGraph: {
      title: view.title,
      description: view.subtitle ?? view.orgName,
      siteName: "Glass",
    },
    twitter: {
      title: view.title,
      description: view.subtitle ?? view.orgName,
    },
  };
}

function PolicyPanel({ policy }: { policy: Policy }) {
  return (
    <section className="border-t border-black/10 py-7">
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <div>
          <h2 className="text-base font-medium text-black">Policy</h2>
          <p className="mt-1 text-sm text-black/60">{policy.title}</p>
        </div>
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Named insured" value={policy.insuredName} />
            <Info label="Carrier" value={policy.carrier ?? "Not listed"} />
            <Info label="Policy number" value={policy.policyNumber} />
            <Info label="Type" value={policy.policyTypes.join(", ") || "Not listed"} />
            <Info label="Effective" value={formatDate(policy.effectiveDate)} />
            <Info label="Expiration" value={formatDate(policy.expirationDate)} />
          </div>
          {policy.coverages.length > 0 ? (
            <div className="overflow-hidden border border-black/10">
              <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-black/10 bg-black/[0.03] px-3 py-2 text-xs font-medium uppercase tracking-normal text-black/60">
                <div>Coverage</div>
                <div>Limit</div>
                <div>Deductible</div>
              </div>
              {policy.coverages.map((coverage) => (
                <div
                  key={`${coverage.name}-${coverage.limit ?? ""}-${coverage.deductible ?? ""}`}
                  className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-black/5 px-3 py-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0 pr-3 text-black">{coverage.name}</div>
                  <div className="min-w-0 pr-3 text-black/70">{coverage.limit ?? "Not listed"}</div>
                  <div className="min-w-0 text-black/70">{coverage.deductible ?? "Not listed"}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-normal text-black/50">{label}</div>
      <div className="mt-1 text-sm text-black">{value}</div>
    </div>
  );
}

export default async function ImessageSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadView(token).catch(() => null);

  if (!view) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black sm:px-10">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-medium text-black/50">Glass</p>
          <h1 className="mt-5 text-3xl font-semibold tracking-normal">Link unavailable</h1>
          <p className="mt-3 max-w-xl text-base text-black/60">
            This shared record could not be found.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-black sm:px-10 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="pb-7">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-black/50">Glass</p>
            <p className="text-sm text-black/50">{view.orgName}</p>
          </div>
          <h1 className="mt-8 max-w-3xl text-3xl font-semibold tracking-normal sm:text-4xl">
            {view.title}
          </h1>
          {view.subtitle ? (
            <p className="mt-3 max-w-2xl text-base text-black/60">{view.subtitle}</p>
          ) : null}
          {view.label ? (
            <p className="mt-3 text-sm text-black/50">{view.label}</p>
          ) : null}
        </header>

        {view.certificate ? (
          <section className="border-t border-black/10 py-7">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div>
                <h2 className="text-base font-medium text-black">Certificate</h2>
                <p className="mt-1 text-sm text-black/60">{view.certificate.holderName}</p>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info label="Status" value={labelForStatus(view.certificate.certificationStatus)} />
                  <Info label="Authority" value={labelForStatus(view.certificate.authorityType)} />
                  <Info label="Issued" value={formatDate(view.certificate.createdAt)} />
                  <Info
                    label="Version"
                    value={view.certificate.versionNumber ? String(view.certificate.versionNumber) : "Not listed"}
                  />
                </div>
                {view.certificate.fileUrl ? (
                  <div>
                    <a
                      href={view.certificate.fileUrl}
                      className="inline-flex h-9 items-center justify-center bg-black px-4 text-sm font-medium text-white"
                    >
                      Open PDF
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {view.certificateRequest ? (
          <section className="border-t border-black/10 py-7">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div>
                <h2 className="text-base font-medium text-black">Certificate request</h2>
                <p className="mt-1 text-sm text-black/60">{view.certificateRequest.holderName}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Status" value={labelForStatus(view.certificateRequest.status)} />
                <Info label="Program administrator" value={view.certificateRequest.partnerName ?? "Not listed"} />
                <Info label="Created" value={formatDate(view.certificateRequest.createdAt)} />
                <Info label="Updated" value={formatDate(view.certificateRequest.updatedAt)} />
              </div>
            </div>
          </section>
        ) : null}

        {view.policyChange ? (
          <section className="border-t border-black/10 py-7">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div>
                <h2 className="text-base font-medium text-black">Policy change</h2>
                <p className="mt-1 text-sm text-black/60">{labelForStatus(view.policyChange.status)}</p>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info label="Created" value={formatDate(view.policyChange.createdAt)} />
                  <Info label="Updated" value={formatDate(view.policyChange.updatedAt)} />
                </div>
                {view.policyChange.summary ? (
                  <p className="text-sm leading-6 text-black/75">{view.policyChange.summary}</p>
                ) : null}
                {view.policyChange.requestText ? (
                  <div className="border border-black/10 p-4 text-sm leading-6 text-black/75">
                    {view.policyChange.requestText}
                  </div>
                ) : null}
                {view.policyChange.pendingQuestions.length > 0 ? (
                  <div className="grid gap-2">
                    {view.policyChange.pendingQuestions.map((question) => (
                      <div key={question} className="border border-black/10 px-3 py-2 text-sm text-black/75">
                        {question}
                      </div>
                    ))}
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
