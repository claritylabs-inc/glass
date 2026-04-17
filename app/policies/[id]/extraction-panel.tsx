"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Scale,
  Phone,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";

// ─── Shared sub-components (moved from page.tsx) ─────────────────────────────

const SECTION_TYPE_LABELS: Record<string, string> = {
  declarations: "Declarations",
  insuring_agreement: "Insuring Agreement",
  policy_form: "Policy Form",
  endorsement: "Endorsement",
  application: "Application",
  exclusion: "Exclusion",
  condition: "Condition",
  definition: "Definition",
  schedule: "Schedule",
  subjectivity: "Subjectivity",
  warranty: "Warranty",
  notice: "Notice",
  regulatory: "Regulatory",
  other: "Other",
};

const SECTION_TYPE_COLORS: Record<string, string> = {
  declarations:
    "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  insuring_agreement:
    "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400",
  policy_form:
    "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  endorsement:
    "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  application:
    "bg-lime-50 text-lime-600 dark:bg-lime-950/40 dark:text-lime-400",
  exclusion: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  condition:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  definition:
    "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
  schedule:
    "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  subjectivity:
    "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
  warranty: "bg-pink-50 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400",
  notice: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
  regulatory:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  other: "bg-gray-50 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

function PageRef({ page }: { page: number }) {
  const pdf = usePdf();

  if (!pdf.fileUrl) {
    return (
      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/5 text-muted-foreground/60">
        p.{page}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        pdf.navigateToPage(page);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          pdf.navigateToPage(page);
        }
      }}
      className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/5 text-muted-foreground/60 hover:bg-blue-100 hover:text-blue-600 transition-colors cursor-pointer"
    >
      p.{page}
    </span>
  );
}

function DocContent({ children }: { children: string }) {
  return (
    <ProseMarkdown gfm className="text-foreground">
      {children}
    </ProseMarkdown>
  );
}

function StructuredRawText({ content }: { content?: string | null }) {
  if (!content?.trim()) return null;
  return (
    <details className="group/raw rounded-md border border-foreground/6 bg-foreground/[0.015]">
      <summary className="flex items-center gap-2 px-3 py-2 text-label-sm text-muted-foreground/70 cursor-pointer hover:text-muted-foreground transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
        <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
        Source text
      </summary>
      <div className="border-t border-foreground/6 px-3 py-3">
        <DocContent>{content}</DocContent>
      </div>
    </details>
  );
}

function StructuredJsonDetails({ item }: { item: unknown }) {
  if (!item || typeof item !== "object") return null;
  return (
    <details className="group/json rounded-md border border-foreground/6 bg-foreground/[0.015]">
      <summary className="flex items-center gap-2 px-3 py-2 text-label-sm text-muted-foreground/70 cursor-pointer hover:text-muted-foreground transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
        <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/json:rotate-90" />
        Extracted object
      </summary>
      <div className="border-t border-foreground/6 px-3 py-3">
        <pre className="overflow-x-auto text-label-sm text-foreground whitespace-pre-wrap break-words">
          {JSON.stringify(item, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function formatStructuredLabel(value?: string | null) {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStructuredValue(value: unknown): string[] | string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const items = value
      .flatMap((item) => {
        if (item == null) return [];
        if (typeof item === "string") return [item];
        if (typeof item === "number" || typeof item === "boolean")
          return [String(item)];
        return [JSON.stringify(item)];
      })
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value, null, 2);
}

function StructuredFieldGrid({
  fields,
}: {
  fields: { label: string; value: unknown }[];
}) {
  const visibleFields = fields
    .map((field) => ({
      label: field.label,
      value: normalizeStructuredValue(field.value),
    }))
    .filter((field) => field.value !== null);

  if (visibleFields.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visibleFields.map((field) => (
        <div
          key={field.label}
          className="rounded-md border border-foreground/6 bg-foreground/[0.015] px-3 py-2"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {field.label}
          </p>
          {Array.isArray(field.value) ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {field.value.map((item) => (
                <span
                  key={item}
                  className="inline-flex rounded-full bg-white/80 px-2 py-0.5 text-label-sm text-foreground dark:bg-white/[0.06]"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-body-sm text-foreground whitespace-pre-wrap break-words">
              {field.value}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Section / Exclusion / Condition / Endorsement cards ─────────────────────

function DocumentSection({
  section,
  highlighted,
}: {
  section: any;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const typeColor =
    SECTION_TYPE_COLORS[section.type] ?? SECTION_TYPE_COLORS.other;

  useEffect(() => {
    if (highlighted) {
      setExpanded(true);
      const timer = setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlighted]);

  return (
    <div
      ref={sectionRef}
      className={`border-t border-foreground/4 transition-colors duration-700 ${highlighted ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-foreground/[0.015] transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-body-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {section.sectionNumber && (
            <span className="text-muted-foreground mr-1.5">
              {section.sectionNumber}
            </span>
          )}
          {section.title ??
            SECTION_TYPE_LABELS[section.type] ??
            section.type ??
            "Untitled"}
        </span>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${typeColor}`}
        >
          {SECTION_TYPE_LABELS[section.type] ?? section.type}
        </span>
        <span className="hidden sm:inline-flex">
          <PageRef page={section.pageStart} />
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-10">
          <DocContent>{section.content}</DocContent>
          {section.subsections?.map((sub: any, i: number) => (
            <div key={i} className="mt-3 pl-3 border-l-2 border-foreground/6">
              <p className="text-body-sm font-medium text-foreground mb-1">
                {sub.sectionNumber && (
                  <span className="text-muted-foreground mr-1.5">
                    {sub.sectionNumber}
                  </span>
                )}
                {sub.title}
                {sub.pageNumber != null && <PageRef page={sub.pageNumber} />}
              </p>
              <DocContent>{sub.content}</DocContent>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExclusionBody({ ex }: { ex: any }) {
  const metaItems = [
    ex?.formNumber && { label: "Form", value: ex.formNumber },
    ex?.appliesTo && { label: "Applies to", value: ex.appliesTo },
    ex?.buybackAvailable &&
      ex?.buybackEndorsement && {
        label: "Buyback",
        value: ex.buybackEndorsement,
      },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-2">
      {metaItems.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-label-sm text-muted-foreground">
          {metaItems.map((m) => (
            <span key={m.label}>
              <span className="text-muted-foreground/60">{m.label}:</span>{" "}
              <span className="text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}
      {ex?.excludedPerils && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Excluded Perils
          </p>
          <p className="text-body-sm text-foreground leading-relaxed">
            {ex.excludedPerils}
          </p>
        </div>
      )}
      {ex?.exceptions && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Exceptions
          </p>
          <p className="text-body-sm text-foreground leading-relaxed">
            {ex.exceptions}
          </p>
        </div>
      )}
      <StructuredRawText content={ex?.content} />
      <StructuredJsonDetails item={ex} />
    </div>
  );
}

function ConditionBody({ c }: { c: any }) {
  const keyValues = c?.keyValues as { key: string; value: string }[] | undefined;
  return (
    <div className="space-y-2">
      {keyValues && keyValues.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Terms
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm">
            {keyValues.map((entry, i) => (
              <span key={i} className="text-foreground">
                <span className="text-muted-foreground/60">{entry.key}:</span>{" "}
                {entry.value}
              </span>
            ))}
          </div>
        </div>
      )}
      <StructuredRawText content={c?.content} />
      <StructuredJsonDetails item={c} />
    </div>
  );
}

function EndorsementBody({ e }: { e: any }) {
  const metaItems = [
    e?.formNumber && { label: "Form", value: e.formNumber },
    e?.editionDate && { label: "Edition", value: e.editionDate },
    e?.effectiveDate && { label: "Effective", value: e.effectiveDate },
    e?.premiumImpact && { label: "Premium", value: e.premiumImpact },
  ].filter(Boolean) as { label: string; value: string }[];

  const namedParties = e?.namedParties as any[] | undefined;

  return (
    <div className="space-y-2">
      {metaItems.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-label-sm text-muted-foreground">
          {metaItems.map((m) => (
            <span key={m.label}>
              <span className="text-muted-foreground/60">{m.label}:</span>{" "}
              <span className="text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}
      {e?.affectedCoverageParts && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Affected Coverage Parts
          </p>
          <p className="text-body-sm text-foreground leading-relaxed">
            {Array.isArray(e.affectedCoverageParts)
              ? e.affectedCoverageParts.join(", ")
              : e.affectedCoverageParts}
          </p>
        </div>
      )}
      {namedParties && namedParties.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Named Parties
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm">
            {namedParties.map((party, i) => {
              const role = formatStructuredLabel(party.role);
              const detail = [party.relationship, party.scope]
                .filter(Boolean)
                .join(" — ");
              return (
                <span key={i} className="text-foreground">
                  {party.name}
                  {role && (
                    <span className="text-muted-foreground/60"> [{role}]</span>
                  )}
                  {detail && (
                    <span className="text-muted-foreground/60"> ({detail})</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {e?.keyTerms && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
            Key Terms
          </p>
          <p className="text-body-sm text-foreground leading-relaxed">
            {Array.isArray(e.keyTerms) ? e.keyTerms.join(", ") : e.keyTerms}
          </p>
        </div>
      )}
      <StructuredRawText content={e?.content} />
      <StructuredJsonDetails item={e} />
    </div>
  );
}

function StructuredItemsCard({
  id,
  title,
  items,
  getTitle,
  getPage,
  getBadges,
  renderBody,
}: {
  id: string;
  title: string;
  items: any[];
  getTitle: (item: any) => string;
  getPage?: (item: any) => number | undefined;
  getBadges?: (item: any) => { label: string; className: string }[];
  renderBody: (item: any) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (!items?.length) return null;

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div
      id={id}
      className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden"
    >
      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {title} ({items.length})
        </p>
      </div>
      {items.map((item, i) => {
        const badges = getBadges?.(item) ?? [];
        const page = getPage?.(item);
        return (
          <div key={i} className="border-t border-foreground/4 first:border-t-0">
            <button
              type="button"
              onClick={() => toggle(i)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-foreground/[0.01] transition-colors cursor-pointer"
            >
              {expanded.has(i) ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-body-sm font-medium text-foreground flex-1 min-w-0 truncate">
                {getTitle(item)}
              </span>
              {badges.length > 0 && (
                <div className="hidden md:flex items-center gap-1.5 shrink-0">
                  {badges.map((badge) => (
                    <span
                      key={badge.label}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              )}
              {page != null && <PageRef page={page} />}
            </button>
            {expanded.has(i) && (
              <div className="space-y-3 px-4 pb-3 pl-10">
                {badges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 md:hidden">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
                {renderBody(item)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Supplementary cards ──────────────────────────────────────────────────────

function ContactCard({
  contact,
  showType,
}: {
  contact: any;
  showType?: boolean;
}) {
  const fields = [
    contact.phone && { label: "Phone", value: contact.phone },
    contact.fax && { label: "Fax", value: contact.fax },
    contact.email && { label: "Email", value: contact.email },
    contact.hours && { label: "Hours", value: contact.hours },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="border-t border-foreground/4 first:border-t-0 px-4 py-3">
      <div className="flex items-center gap-2">
        {contact.name && (
          <p className="text-body-sm font-medium text-foreground">
            {contact.name}
          </p>
        )}
        {showType && contact.type && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted-foreground">
            {contact.type}
          </span>
        )}
      </div>
      {contact.title && (
        <p className="text-body-sm text-muted-foreground mt-0.5">
          {contact.title}
        </p>
      )}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
          {fields.map((f) => (
            <p key={f.label} className="text-body-sm text-foreground">
              <span className="text-muted-foreground">{f.label}:</span>{" "}
              {f.value}
            </p>
          ))}
        </div>
      )}
      {contact.address && (
        <p className="text-body-sm text-muted-foreground mt-1">
          {contact.address}
        </p>
      )}
    </div>
  );
}

function SupplementaryCard({
  title,
  icon: Icon,
  pageNumber,
  content,
  hasStructured,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  pageNumber?: number;
  content: string;
  hasStructured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </p>
          {pageNumber != null && <PageRef page={pageNumber} />}
        </div>
      </div>
      {hasStructured ? (
        <>
          <div className="px-4 py-3">{children}</div>
          <details className="group/raw border-t border-foreground/4">
            <summary className="flex items-center gap-2 px-4 py-2.5 text-label-sm text-muted-foreground/50 cursor-pointer hover:text-muted-foreground hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
              View raw text
            </summary>
            <div className="px-4 pt-1 pb-3">
              <p className="text-body-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {content}
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="px-4 py-3">
          <p className="text-body-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

function RegulatoryContextStructured({ data }: { data: any }) {
  const gridItems = [
    { label: "Jurisdiction", value: data.jurisdiction },
    { label: "Regulatory Body", value: data.regulatoryBody },
    { label: "Governing Law", value: data.governingLaw },
  ].filter((item) => item.value);

  return (
    <div className="-mx-4 -mt-3">
      {gridItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:divide-x divide-foreground/6 border-b border-foreground/4">
          {gridItems.map((item) => (
            <div key={item.label} className="flex-1 px-4 py-2.5">
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                {item.label}
              </p>
              <p className="text-body-sm text-foreground font-medium">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}
      {data.details?.length > 0 && (
        <table className="w-full text-left">
          <tbody>
            {data.details.map((d: any, i: number) => (
              <tr
                key={i}
                className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors"
              >
                <td className="px-4 py-2.5 text-body-sm text-muted-foreground align-top">
                  {d.label}
                </td>
                <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">
                  {d.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ComplaintContactStructured({ contacts }: { contacts?: any[] }) {
  if (!contacts?.length) return null;
  return (
    <div className="-mx-4 -mt-3">
      {contacts.map((c: any, i: number) => (
        <ContactCard key={i} contact={c} showType />
      ))}
    </div>
  );
}

function ClaimsContactStructured({ data }: { data: any }) {
  return (
    <div className="-mx-4 -mt-3">
      {data.contacts?.length > 0 && (
        <div>
          {data.contacts.map((c: any, i: number) => (
            <ContactCard key={i} contact={c} />
          ))}
        </div>
      )}
      {data.processSteps?.length > 0 && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Claims Process
          </p>
          <ol className="space-y-1.5">
            {data.processSteps.map((step: string, i: number) => (
              <li key={i} className="flex gap-2.5 text-body-sm text-foreground">
                <span className="text-muted-foreground/60 font-mono text-label-sm mt-px shrink-0">
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.reportingTimeLimit && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Reporting Time Limit
          </p>
          <p className="text-body-sm text-foreground font-medium">
            {data.reportingTimeLimit}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Group wrapper ─────────────────────────────────────────────────────────────

function GroupSection({
  label,
  children,
  defaultOpen,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-t border-foreground/6 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-foreground/[0.02] transition-colors cursor-pointer"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-body-sm font-semibold text-foreground flex-1">
          {label}
        </span>
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ExtractionPanelProps {
  /** The full `document` field from the policy record */
  policyDocument: any;
  /** page number that triggered the URL (for section highlighting) */
  initialPage?: number;
}

export function ExtractionPanel({
  policyDocument,
  initialPage,
}: ExtractionPanelProps) {
  const [open, setOpen] = useState(false);

  const hasCoverageAndLimits =
    policyDocument?.sections?.length > 0 ||
    policyDocument?.endorsements?.length > 0 ||
    policyDocument?.costsAndFees;

  const hasExclusionsAndConditions =
    policyDocument?.exclusions?.length > 0 ||
    policyDocument?.conditions?.length > 0;

  const hasContactsAndRegulatory =
    policyDocument?.claimsContact ||
    policyDocument?.complaintContact ||
    policyDocument?.regulatoryContext;

  const hasAnyData =
    hasCoverageAndLimits || hasExclusionsAndConditions || hasContactsAndRegulatory;

  if (!hasAnyData) return null;

  return (
    <div className="rounded-xl border border-foreground/8 bg-white/60 dark:bg-white/[0.04] overflow-hidden shadow-sm mt-4">
      {/* Top toggle row */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-foreground/[0.02] transition-colors cursor-pointer"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <Wrench className="w-4 h-4 text-muted-foreground/50 shrink-0" />
        <span className="text-body-sm font-semibold text-foreground flex-1">
          Extraction Details
        </span>
        <span className="text-label-sm text-muted-foreground/40 hidden sm:block">
          Audit / debug view
        </span>
      </button>

      {open && (
        <div className="border-t border-foreground/6">
          {/* Group 1: Coverage & Limits */}
          {hasCoverageAndLimits && (
            <GroupSection label="Coverage & Limits">
              {policyDocument?.sections?.length > 0 && (
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
                  <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                    <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Document Sections ({policyDocument.sections.length})
                    </p>
                  </div>
                  {policyDocument.sections.map((section: any, i: number) => (
                    <DocumentSection
                      key={i}
                      section={section}
                      highlighted={
                        initialPage != null &&
                        section.pageStart <= initialPage &&
                        (section.pageEnd ?? section.pageStart) >= initialPage
                      }
                    />
                  ))}
                </div>
              )}

              {policyDocument?.endorsements?.length > 0 && (
                <StructuredItemsCard
                  id="ep-endorsements"
                  title="Endorsements"
                  items={policyDocument.endorsements}
                  getTitle={(e) =>
                    e.title ?? e.name ?? e.formNumber ?? "Unnamed endorsement"
                  }
                  getPage={(e) => e.pageStart}
                  getBadges={(e) =>
                    [
                      e?.endorsementType
                        ? {
                            label:
                              formatStructuredLabel(e.endorsementType) ??
                              e.endorsementType,
                            className:
                              e.endorsementType === "restriction" ||
                              e.endorsementType === "exclusion"
                                ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                                : e.endorsementType === "broadening"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                  : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
                          }
                        : undefined,
                      e?.effectiveDate
                        ? {
                            label: `Eff. ${e.effectiveDate}`,
                            className: "bg-foreground/5 text-muted-foreground",
                          }
                        : undefined,
                    ].filter(Boolean) as { label: string; className: string }[]
                  }
                  renderBody={(e) => <EndorsementBody e={e} />}
                />
              )}

              {policyDocument?.costsAndFees && (
                <SupplementaryCard
                  title="Costs & Fees"
                  icon={Wrench}
                  pageNumber={policyDocument.costsAndFees.pageNumber}
                  content={policyDocument.costsAndFees.content ?? ""}
                  hasStructured={
                    !!policyDocument.costsAndFees.fees?.length
                  }
                >
                  {policyDocument.costsAndFees.fees?.length > 0 && (
                    <div className="-mx-4 -mt-3">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-foreground/[0.02]">
                            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">
                              Amount
                            </th>
                            <th className="hidden sm:table-cell px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {policyDocument.costsAndFees.fees.map(
                            (f: any, i: number) => (
                              <tr
                                key={i}
                                className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                              >
                                <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">
                                  {f.name}
                                </td>
                                <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right">
                                  {f.amount ?? "—"}
                                </td>
                                <td className="hidden sm:table-cell px-4 py-2.5 text-body-sm text-muted-foreground">
                                  {f.type ?? "—"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SupplementaryCard>
              )}
            </GroupSection>
          )}

          {/* Group 2: Exclusions & Conditions */}
          {hasExclusionsAndConditions && (
            <GroupSection label="Exclusions & Conditions">
              {policyDocument?.exclusions?.length > 0 && (
                <StructuredItemsCard
                  id="ep-exclusions"
                  title="Exclusions"
                  items={policyDocument.exclusions}
                  getTitle={(ex) =>
                    typeof ex === "string"
                      ? ex
                      : (ex?.name ?? ex?.title ?? "Unnamed exclusion")
                  }
                  getPage={(ex) => ex?.pageNumber ?? ex?.pageStart}
                  getBadges={(ex) => {
                    if (typeof ex === "string") return [];
                    return [
                      ex?.isAbsolute
                        ? {
                            label: "Absolute",
                            className:
                              "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
                          }
                        : {
                            label: "Limited",
                            className:
                              "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                          },
                      ex?.buybackAvailable
                        ? {
                            label: "Buyback",
                            className:
                              "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                          }
                        : undefined,
                    ].filter(Boolean) as { label: string; className: string }[];
                  }}
                  renderBody={(ex) => {
                    if (typeof ex === "string") {
                      return <StructuredRawText content={ex} />;
                    }
                    return <ExclusionBody ex={ex} />;
                  }}
                />
              )}

              {policyDocument?.conditions?.length > 0 && (
                <StructuredItemsCard
                  id="ep-conditions"
                  title="Conditions"
                  items={policyDocument.conditions}
                  getTitle={(c) => c.name ?? c.title ?? "Unnamed condition"}
                  getPage={(c) => c.pageNumber}
                  getBadges={(c) =>
                    c?.conditionType
                      ? [
                          {
                            label:
                              formatStructuredLabel(c.conditionType) ??
                              c.conditionType,
                            className:
                              "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                          },
                        ]
                      : []
                  }
                  renderBody={(c) => <ConditionBody c={c} />}
                />
              )}
            </GroupSection>
          )}

          {/* Group 3: Contacts & Regulatory */}
          {hasContactsAndRegulatory && (
            <GroupSection label="Contacts & Regulatory">
              {policyDocument?.claimsContact && (
                <SupplementaryCard
                  title="Claims Contact"
                  icon={AlertTriangle}
                  pageNumber={policyDocument.claimsContact.pageNumber}
                  content={policyDocument.claimsContact.content}
                  hasStructured={
                    !!(
                      policyDocument.claimsContact.contacts?.length ||
                      policyDocument.claimsContact.processSteps?.length ||
                      policyDocument.claimsContact.reportingTimeLimit
                    )
                  }
                >
                  <ClaimsContactStructured
                    data={policyDocument.claimsContact}
                  />
                </SupplementaryCard>
              )}

              {policyDocument?.complaintContact && (
                <SupplementaryCard
                  title="Complaint Contact"
                  icon={Phone}
                  pageNumber={policyDocument.complaintContact.pageNumber}
                  content={policyDocument.complaintContact.content}
                  hasStructured={
                    !!policyDocument.complaintContact.contacts?.length
                  }
                >
                  <ComplaintContactStructured
                    contacts={policyDocument.complaintContact.contacts}
                  />
                </SupplementaryCard>
              )}

              {policyDocument?.regulatoryContext && (
                <SupplementaryCard
                  title="Regulatory Context"
                  icon={Scale}
                  pageNumber={policyDocument.regulatoryContext.pageNumber}
                  content={policyDocument.regulatoryContext.content}
                  hasStructured={
                    !!(
                      policyDocument.regulatoryContext.jurisdiction ||
                      policyDocument.regulatoryContext.regulatoryBody ||
                      policyDocument.regulatoryContext.governingLaw ||
                      policyDocument.regulatoryContext.details?.length
                    )
                  }
                >
                  <RegulatoryContextStructured
                    data={policyDocument.regulatoryContext}
                  />
                </SupplementaryCard>
              )}
            </GroupSection>
          )}
        </div>
      )}
    </div>
  );
}
