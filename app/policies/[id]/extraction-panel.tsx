"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";

// ─── Internal types for policy document data ──────────────────────────────────

type PolicySubsection = {
  sectionNumber?: string;
  title?: string;
  content: string;
  pageNumber?: number;
};

type PolicySection = {
  type: string;
  title?: string;
  sectionNumber?: string;
  content: string;
  pageStart: number;
  pageEnd?: number;
  subsections?: PolicySubsection[];
};

type ContactEntry = {
  name?: string;
  title?: string;
  type?: string;
  phone?: string;
  fax?: string;
  email?: string;
  hours?: string;
  address?: string;
};

type PolicyExclusion = {
  name?: string;
  title?: string;
  content?: string;
  isAbsolute?: boolean;
  buybackAvailable?: boolean;
  buybackEndorsement?: string;
  appliesTo?: string | string[];
  formNumber?: string;
  pageNumber?: number;
  pageStart?: number;
};

type PolicyCondition = {
  name?: string;
  title?: string;
  content?: string;
  conditionType?: string;
  keyValues?: { key: string; value: string }[];
  pageNumber?: number;
};

type PolicyEndorsement = {
  title?: string;
  name?: string;
  formNumber?: string;
  editionDate?: string;
  effectiveDate?: string;
  premiumImpact?: string;
  endorsementType?: string;
  content?: string;
  pageStart?: number;
};

type FeeEntry = {
  name: string;
  amount?: string;
  type?: string;
};

type PolicyFee = {
  content?: string;
  pageNumber?: number;
  fees?: FeeEntry[];
};

type RegulatoryDetail = { label: string; value: string };

type RegulatoryContext = {
  content: string;
  pageNumber?: number;
  jurisdiction?: string;
  regulatoryBody?: string;
  governingLaw?: string;
  details?: RegulatoryDetail[];
};

type ClaimsContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
  processSteps?: string[];
  reportingTimeLimit?: string;
};

type ComplaintContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
};

type PolicyDocument = {
  sections?: PolicySection[];
  endorsements?: PolicyEndorsement[];
  costsAndFees?: PolicyFee;
  exclusions?: (PolicyExclusion | string)[];
  conditions?: PolicyCondition[];
  claimsContact?: ClaimsContact;
  complaintContact?: ComplaintContact;
  regulatoryContext?: RegulatoryContext;
};

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
    <ProseMarkdown gfm className="text-foreground !text-sm !leading-relaxed">
      {children}
    </ProseMarkdown>
  );
}

function formatStructuredLabel(value?: string | null) {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ─── Section / Exclusion / Condition / Endorsement cards ─────────────────────

function DocumentSection({
  section,
  highlighted,
}: {
  section: PolicySection;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => !!highlighted);
  const sectionRef = useRef<HTMLDivElement>(null);
  const prevHighlighted = useRef(highlighted);
  const typeColor =
    SECTION_TYPE_COLORS[section.type] ?? SECTION_TYPE_COLORS.other;

  // When highlighted newly becomes true, expand and scroll
  useEffect(() => {
    if (highlighted && !prevHighlighted.current && !expanded) {
      setTimeout(() => setExpanded(true), 0);
    }
    prevHighlighted.current = highlighted;
  }, [highlighted, expanded]);

  // Scroll into view in a separate effect (no setState)
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(timer);
  }, [highlighted]);

  return (
    <div
      ref={sectionRef}
      className={`border-t border-foreground/4 transition-colors duration-700 ${highlighted ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-5 py-2.5 text-left hover:bg-foreground/[0.015] transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-normal text-foreground flex-1 min-w-0 truncate">
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
        <div className="px-5 pt-2 pb-3 pl-11">
          <DocContent>{section.content}</DocContent>
          {section.subsections?.map((sub: PolicySubsection, i: number) => (
            <div key={i} className="mt-3 pl-3 border-l-2 border-foreground/6">
              <p className="text-sm font-medium text-foreground mb-1">
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

function ExclusionBody({ ex }: { ex: PolicyExclusion }) {
  const metaItems = [
    ex?.formNumber && { label: "Form", value: ex.formNumber },
    ex?.appliesTo && {
      label: "Applies to",
      value: Array.isArray(ex.appliesTo)
        ? ex.appliesTo.join(", ")
        : ex.appliesTo,
    },
    ex?.buybackAvailable &&
      ex?.buybackEndorsement && {
        label: "Buyback",
        value: ex.buybackEndorsement,
      },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {metaItems.map((m) => (
            <span key={m.label}>
              <span className="text-muted-foreground/60">{m.label}:</span>{" "}
              <span className="text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}
      {ex?.content && <DocContent>{ex.content}</DocContent>}
    </div>
  );
}

function ConditionBody({ c }: { c: PolicyCondition }) {
  const keyValues = c?.keyValues as { key: string; value: string }[] | undefined;
  return (
    <div className="space-y-3">
      {keyValues && keyValues.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {keyValues.map((entry, i) => (
            <span key={i} className="text-foreground">
              <span className="text-muted-foreground/60">{entry.key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim()}:</span>{" "}
              {entry.value}
            </span>
          ))}
        </div>
      )}
      {c?.content && <DocContent>{c.content}</DocContent>}
    </div>
  );
}

function EndorsementBody({ e }: { e: PolicyEndorsement }) {
  const metaItems = [
    e?.formNumber && { label: "Form", value: e.formNumber },
    e?.editionDate && { label: "Edition", value: e.editionDate },
    e?.effectiveDate && { label: "Effective", value: e.effectiveDate },
    e?.premiumImpact && { label: "Premium", value: e.premiumImpact },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {metaItems.map((m) => (
            <span key={m.label}>
              <span className="text-muted-foreground/60">{m.label}:</span>{" "}
              <span className="text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}
      {e?.content && <DocContent>{e.content}</DocContent>}
    </div>
  );
}

function StructuredItemsCard<T>({
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
  items: T[];
  getTitle: (item: T) => string;
  getPage?: (item: T) => number | undefined;
  getBadges?: (item: T) => { label: string; className: string }[];
  renderBody: (item: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (!items?.length) return null;

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });

  return (
    <div id={id}>
      <div className="px-5 py-3 border-b border-foreground/4">
        <p className="text-sm font-medium text-foreground">
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
              className="w-full flex items-center gap-2 px-5 py-2.5 text-left hover:bg-foreground/[0.015] transition-colors cursor-pointer"
            >
              {expanded.has(i) ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-normal text-foreground flex-1 min-w-0 truncate">
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
              <div className="space-y-3 px-5 pt-2 pb-3 pl-11">
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
  contact: ContactEntry;
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
          <p className="text-sm font-medium text-foreground">
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
        <p className="text-sm text-muted-foreground mt-0.5">
          {contact.title}
        </p>
      )}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
          {fields.map((f) => (
            <p key={f.label} className="text-sm text-foreground">
              <span className="text-muted-foreground">{f.label}:</span>{" "}
              {f.value}
            </p>
          ))}
        </div>
      )}
      {contact.address && (
        <p className="text-sm text-muted-foreground mt-1">
          {contact.address}
        </p>
      )}
    </div>
  );
}

function SupplementaryCard({
  title,
  icon: _Icon,
  pageNumber,
  content,
  hasStructured,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  pageNumber?: number;
  content: string;
  hasStructured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-5 py-3 border-b border-foreground/4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          {pageNumber != null && <PageRef page={pageNumber} />}
        </div>
      </div>
      {hasStructured ? (
        <>
          <div className="px-5 py-3">{children}</div>
          <details className="group/raw border-t border-foreground/4">
            <summary className="flex items-center gap-2 px-5 py-2.5 text-xs text-muted-foreground/50 cursor-pointer hover:text-muted-foreground hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
              View raw text
            </summary>
            <div className="px-5 pt-1 pb-3">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {content}
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="px-5 py-3">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

function RegulatoryContextStructured({ data }: { data: RegulatoryContext }) {
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
              <p className="text-xs font-semibold text-muted-foreground mb-0.5">
                {item.label}
              </p>
              <p className="text-sm text-foreground font-medium">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}
      {(data.details?.length ?? 0) > 0 && (
        <table className="w-full text-left">
          <tbody>
            {(data.details ?? []).map((d: RegulatoryDetail, i: number) => (
              <tr
                key={i}
                className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors"
              >
                <td className="px-4 py-2.5 text-sm text-muted-foreground align-top">
                  {d.label}
                </td>
                <td className="px-4 py-2.5 text-sm text-foreground font-medium">
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

function ComplaintContactStructured({ contacts }: { contacts?: ContactEntry[] }) {
  if (!contacts?.length) return null;
  return (
    <div className="-mx-4 -mt-3">
      {contacts.map((c: ContactEntry, i: number) => (
        <ContactCard key={i} contact={c} showType />
      ))}
    </div>
  );
}

function ClaimsContactStructured({ data }: { data: ClaimsContact }) {
  return (
    <div className="-mx-4 -mt-3">
      {(data.contacts?.length ?? 0) > 0 && (
        <div>
          {(data.contacts ?? []).map((c: ContactEntry, i: number) => (
            <ContactCard key={i} contact={c} />
          ))}
        </div>
      )}
      {(data.processSteps?.length ?? 0) > 0 && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Claims Process
          </p>
          <ol className="space-y-1.5">
            {(data.processSteps ?? []).map((step: string, i: number) => (
              <li key={i} className="flex gap-2.5 text-sm text-foreground">
                <span className="text-muted-foreground/60 text-xs mt-px shrink-0">
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
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            Reporting Time Limit
          </p>
          <p className="text-sm text-foreground font-medium">
            {data.reportingTimeLimit}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Group wrapper ─────────────────────────────────────────────────────────────

export function GroupSection({
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
        <span className="text-sm font-medium text-foreground flex-1">
          {label}
        </span>
      </button>
      {open && <div className="space-y-0">{children}</div>}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ExtractionPanelProps {
  /** The full `document` field from the policy record */
  policyDocument: PolicyDocument | null | undefined;
  /** page number that triggered the URL (for section highlighting) */
  initialPage?: number;
}

/** Renders extraction details as separate, flat cards — one per data type */
export function ExtractionCards({
  policyDocument,
  initialPage,
}: ExtractionPanelProps) {
  const sections = policyDocument?.sections ?? [];
  const endorsements = policyDocument?.endorsements ?? [];
  const costsAndFees = policyDocument?.costsAndFees;
  const fees = costsAndFees?.fees ?? [];
  const exclusions = policyDocument?.exclusions ?? [];
  const conditions = policyDocument?.conditions ?? [];

  const hasAnyData =
    sections.length > 0 ||
    endorsements.length > 0 ||
    costsAndFees ||
    exclusions.length > 0 ||
    conditions.length > 0 ||
    policyDocument?.claimsContact ||
    policyDocument?.complaintContact ||
    policyDocument?.regulatoryContext;

  if (!hasAnyData) return null;

  return (
    <div className="space-y-4">
      {/* Document Sections */}
      {sections.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-foreground/4">
            <p className="text-sm font-medium text-foreground">
              Document sections ({sections.length})
            </p>
          </div>
          {sections.map((section: PolicySection, i: number) => (
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

      {/* Endorsements */}
      {endorsements.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-endorsements"
            title="Endorsements"
            items={endorsements}
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
        </div>
      )}

      {/* Costs & Fees */}
      {costsAndFees && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Costs & fees"
            pageNumber={costsAndFees.pageNumber}
            content={costsAndFees.content ?? ""}
            hasStructured={fees.length > 0}
          >
            {fees.length > 0 && (
              <div className="-mx-4 -mt-3">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-foreground/[0.02]">
                      <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">
                        Amount
                      </th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                        Type
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fees as Record<string, unknown>[]).map(
                      (f, i: number) => (
                        <tr
                          key={i}
                          className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                        >
                          <td className="px-4 py-2.5 text-sm text-foreground font-medium">
                            {String(f.name ?? "—")}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-medium text-foreground text-right">
                            {String(f.amount ?? "—")}
                          </td>
                          <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-muted-foreground">
                            {String(f.type ?? "—")}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </SupplementaryCard>
        </div>
      )}

      {/* Exclusions */}
      {exclusions.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-exclusions"
            title="Exclusions"
            items={exclusions}
            getTitle={(ex) =>
              typeof ex === "string"
                ? ex
                : (ex?.name ?? ex?.title ?? "Unnamed exclusion")
            }
            getPage={(ex) =>
              typeof ex === "string" ? undefined : ex.pageNumber ?? ex.pageStart
            }
            getBadges={(ex) => {
              if (typeof ex === "string") return [];
              return [
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
                return <DocContent>{ex}</DocContent>;
              }
              return <ExclusionBody ex={ex} />;
            }}
          />
        </div>
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-conditions"
            title="Conditions"
            items={conditions}
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
        </div>
      )}

      {/* Claims contact */}
      {policyDocument?.claimsContact && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Claims contact"
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
            <ClaimsContactStructured data={policyDocument.claimsContact} />
          </SupplementaryCard>
        </div>
      )}

      {/* Complaint contact */}
      {policyDocument?.complaintContact && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Complaint contact"
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
        </div>
      )}

      {/* Regulatory context */}
      {policyDocument?.regulatoryContext && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Regulatory context"
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
        </div>
      )}
    </div>
  );
}
