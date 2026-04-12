"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign, Trash2, Upload, ChevronDown, ChevronRight, Loader2, Scale, Phone, Receipt, AlertTriangle, Users, Eye, Mail, MessageSquare, Activity, CheckCircle, XCircle, RefreshCw, Asterisk, X, Ban, BookOpen, Stamp, Clock, Code, Play } from "lucide-react";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { ModeBadge } from "@/components/mode-badge";
import { MessageBubble, type Conversation } from "@/components/conversation-message";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { TerminalLog } from "@/components/terminal-log";
import { useRouter, useSearchParams } from "next/navigation";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePdf } from "@/components/pdf-context";
import { usePageContext } from "@/hooks/use-page-context";

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  commercial_property: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  commercial_auto: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  non_owned_auto: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  workers_comp: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  umbrella: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  excess_liability: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  professional_liability: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cyber: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  epli: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  directors_officers: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  fiduciary_liability: "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
  crime_fidelity: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  inland_marine: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  builders_risk: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  environmental: "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
  ocean_marine: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  surety: "bg-stone-100 dark:bg-stone-950/40 text-stone-700 dark:text-stone-400",
  product_liability: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  bop: "bg-slate-100 dark:bg-slate-950/40 text-slate-700 dark:text-slate-400",
  management_liability_package: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  property: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  other: "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400",
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
  declarations: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  insuring_agreement: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400",
  policy_form: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  endorsement: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  application: "bg-lime-50 text-lime-600 dark:bg-lime-950/40 dark:text-lime-400",
  exclusion: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  condition: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  definition: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
  schedule: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  subjectivity: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
  warranty: "bg-pink-50 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400",
  notice: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
  regulatory: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  other: "bg-gray-50 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

function DocumentSection({ section, highlighted }: { section: any; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const typeColor = SECTION_TYPE_COLORS[section.type] || SECTION_TYPE_COLORS.other;

  useEffect(() => {
    if (highlighted) {
      setExpanded(true);
      // Delay scroll to allow expand animation
      const timer = setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlighted]);

  return (
    <div ref={sectionRef} className={`border-t border-foreground/4 transition-colors duration-700 ${highlighted ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}>
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
            <span className="text-muted-foreground mr-1.5">{section.sectionNumber}</span>
          )}
          {section.title}
        </span>
        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${typeColor}`}>
          {SECTION_TYPE_LABELS[section.type] || section.type}
        </span>
        <span className="hidden sm:inline-flex"><PageRef page={section.pageStart} /></span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-10">
          <p className="text-body-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {section.content}
          </p>
          {section.subsections?.map((sub: any, i: number) => (
            <div key={i} className="mt-3 pl-3 border-l-2 border-foreground/6">
              <p className="text-body-sm font-medium text-foreground mb-1">
                {sub.sectionNumber && <span className="text-muted-foreground mr-1.5">{sub.sectionNumber}</span>}
                {sub.title}
                {sub.pageNumber != null && <PageRef page={sub.pageNumber} />}
              </p>
              <p className="text-body-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {sub.content}
              </p>
            </div>
          ))}
        </div>
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
  icon: React.ElementType;
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
          <div className="px-4 py-3">
            {children}
          </div>
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
        <div className={`flex flex-col sm:flex-row sm:divide-x divide-foreground/6 border-b border-foreground/4`}>
          {gridItems.map((item) => (
            <div key={item.label} className="flex-1 px-4 py-2.5">
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{item.label}</p>
              <p className="text-body-sm text-foreground font-medium">{item.value}</p>
            </div>
          ))}
        </div>
      )}
      {data.details?.length > 0 && (
        <table className="w-full text-left">
          <tbody>
            {data.details.map((d: any, i: number) => (
              <tr key={i} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                <td className="px-4 py-2.5 text-body-sm text-muted-foreground align-top">{d.label}</td>
                <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ContactCard({ contact, showType }: { contact: any; showType?: boolean }) {
  const fields = [
    contact.phone && { label: "Phone", value: contact.phone },
    contact.fax && { label: "Fax", value: contact.fax },
    contact.email && { label: "Email", value: contact.email },
    contact.hours && { label: "Hours", value: contact.hours },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="border-t border-foreground/4 first:border-t-0 px-4 py-3">
      <div className="flex items-center gap-2">
        {contact.name && <p className="text-body-sm font-medium text-foreground">{contact.name}</p>}
        {showType && contact.type && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted-foreground">
            {contact.type}
          </span>
        )}
      </div>
      {contact.title && (
        <p className="text-body-sm text-muted-foreground mt-0.5">{contact.title}</p>
      )}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
          {fields.map((f) => (
            <p key={f.label} className="text-body-sm text-foreground">
              <span className="text-muted-foreground">{f.label}:</span> {f.value}
            </p>
          ))}
        </div>
      )}
      {contact.address && (
        <p className="text-body-sm text-muted-foreground mt-1">{contact.address}</p>
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

function CostsAndFeesStructured({ fees }: { fees?: any[] }) {
  if (!fees?.length) return null;

  return (
    <div className="-mx-4 -mt-3">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-foreground/[0.02]">
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
            <th className="hidden sm:table-cell px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
            <th className="hidden md:table-cell px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
          </tr>
        </thead>
        <tbody>
          {fees.map((f: any, i: number) => (
            <tr key={i} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
              <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">{f.name}</td>
              <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right">{f.amount || "—"}</td>
              <td className="hidden sm:table-cell px-4 py-2.5 text-body-sm text-muted-foreground">{f.type || "—"}</td>
              <td className="hidden md:table-cell px-4 py-2.5 text-body-sm text-foreground">{f.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Claims Process</p>
          <ol className="space-y-1.5">
            {data.processSteps.map((step: string, i: number) => (
              <li key={i} className="flex gap-2.5 text-body-sm text-foreground">
                <span className="text-muted-foreground/60 font-mono text-label-sm mt-px shrink-0">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.reportingTimeLimit && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reporting Time Limit</p>
          <p className="text-body-sm text-foreground font-medium">{data.reportingTimeLimit}</p>
        </div>
      )}
    </div>
  );
}

/* ── Section Outline Sidebar ── */

function SectionOutline({ sections }: { sections: Array<{ id: string; label: string; count?: number }> }) {
  const visible = sections.filter((s) => s.count === undefined || s.count > 0);
  const [activeId, setActiveId] = useState(visible[0]?.id ?? "");
  const [expanded, setExpanded] = useState(false);
  const [scrollExpanded, setScrollExpanded] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 },
    );
    for (const s of visible) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [visible]);

  // Expand on scroll, collapse after idle
  useEffect(() => {
    const handleScroll = () => {
      setScrollExpanded(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => setScrollExpanded(false), 1500);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  if (visible.length <= 1) return null;

  const isExpanded = expanded || scrollExpanded;

  return (
    <nav
      className="hidden xl:block shrink-0"
      style={{ width: isExpanded ? "176px" : "20px", transition: "width 200ms ease" }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="sticky top-4">
        {isExpanded ? (
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-2 px-2">On this page</p>
            {visible.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`w-full text-left px-2 py-1 rounded-md text-[11px] cursor-pointer transition-colors duration-150 ${
                  activeId === s.id
                    ? "text-foreground font-medium bg-foreground/[0.04]"
                    : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/[0.02]"
                }`}
              >
                {s.label}
                {s.count != null && <span className="text-muted-foreground/30 ml-1">{s.count}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-[6px] pt-6">
            {visible.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="cursor-pointer p-0 border-0 bg-transparent"
              >
                <span
                  className={`block rounded-full transition-all duration-200 ${
                    activeId === s.id
                      ? "w-[5px] h-[5px] bg-foreground/50"
                      : "w-[3px] h-[3px] bg-foreground/15"
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

/* ── Document Structured Cards ── */

function ExclusionsCard({ exclusions }: { exclusions: any[] }) {
  if (!exclusions?.length) return null;

  return (
    <div id="section-exclusions" className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Exclusions ({exclusions.length})
        </p>
      </div>
      <ul className="divide-y divide-foreground/4">
        {exclusions.map((ex, i) => {
          const text = typeof ex === "string" ? ex : ((ex as any)?.content ?? (ex as any)?.title ?? "");
          const page = typeof ex === "object" ? (ex as any)?.pageNumber ?? (ex as any)?.pageStart : undefined;
          return (
            <li key={i} className="flex items-start gap-2 px-4 py-2 text-body-sm text-foreground leading-relaxed hover:bg-foreground/[0.01] transition-colors">
              <span className="text-muted-foreground/40 font-mono text-label-sm mt-0.5 shrink-0 w-5 text-right">{i + 1}.</span>
              <span className="flex-1 min-w-0">{text}</span>
              {page != null && <PageRef page={page} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CollapsibleListCard({ id, title, items, getTitle, getContent, getPage, getBadge }: {
  id: string;
  title: string;
  items: any[];
  getTitle: (item: any) => string;
  getContent: (item: any) => string;
  getPage?: (item: any) => number | undefined;
  getBadge?: (item: any) => { label: string; className: string } | undefined;
}) {
  if (!items?.length) return null;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  return (
    <div id={id} className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {title} ({items.length})
        </p>
      </div>
      {items.map((item, i) => {
        const badge = getBadge?.(item);
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
              {badge && (
                <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}>
                  {badge.label}
                </span>
              )}
              {page != null && <PageRef page={page} />}
            </button>
            {expanded.has(i) && (
              <div className="px-4 pb-3 pl-10">
                <p className="text-body-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {getContent(item)}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


/* ── Extraction Tab ── */

const EXTRACTION_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400" },
  extracting: { label: "Extracting", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400" },
  complete: { label: "Complete", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  error: { label: "Error", color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  not_insurance: { label: "Not Insurance", color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400" },
};

function ExtractionTab({ policy }: { policy: any }) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [runningMode, setRunningMode] = useState<string | null>(null);

  const extractionLog: { timestamp: number; message: string }[] = policy.extractionLog ?? [];
  const statusCfg = EXTRACTION_STATUS_CONFIG[policy.extractionStatus] ?? EXTRACTION_STATUS_CONFIG.pending;
  const rawMetadata: string | undefined = policy.rawMetadataResponse;
  const rawExtraction: string | undefined = policy.rawExtractionResponse;
  const hasDocument = !!(policy as any).document;

  const handleRetry = async (mode: "reparse" | "full") => {
    setRunningMode(mode);
    try {
      const result = await retryExtraction({ policyId: policy._id, mode });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Re-extraction started");
      }
    } catch {
      toast.error("Re-extraction failed");
    } finally {
      setRunningMode(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status + Controls */}
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Extraction Status
            </p>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3 mb-4">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
            {policy.extractionError && (
              <span className="text-body-sm text-red-600 dark:text-red-400">{policy.extractionError}</span>
            )}
          </div>

          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Re-extraction Controls
          </p>
          <div className="flex flex-wrap gap-2">
            {rawExtraction && (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={runningMode !== null}
                onClick={() => handleRetry("reparse")}
              >
                {runningMode === "reparse" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Code className="w-3.5 h-3.5" />}
                Re-parse saved output
              </PillButton>
            )}
            <PillButton
              variant="secondary"
              size="compact"
              disabled={runningMode !== null}
              onClick={() => handleRetry("full")}
            >
              {runningMode === "full" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Full re-extraction
            </PillButton>
          </div>
        </div>
      </div>

      {/* Extraction Log */}
      <TerminalLog
        entries={extractionLog}
        live={policy.extractionStatus === "extracting"}
        emptyMessage="No extraction events recorded"
      />

      {/* Raw Data */}
      {(rawExtraction || rawMetadata) && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
          <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-muted-foreground" />
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Raw Data
              </p>
            </div>
          </div>
          {rawExtraction && (
            <details className="group/raw">
              <summary className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-muted-foreground cursor-pointer hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
                <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
                Raw extraction response ({(rawExtraction.length / 1024).toFixed(1)} KB)
              </summary>
              <div className="px-4 pb-3 max-h-64 overflow-y-auto">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {rawExtraction.slice(0, 5000)}
                  {rawExtraction.length > 5000 && "\n\n... truncated ..."}
                </pre>
              </div>
            </details>
          )}
          {rawMetadata && (
            <details className="group/rawmeta border-t border-foreground/4">
              <summary className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-muted-foreground cursor-pointer hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
                <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/rawmeta:rotate-90" />
                Raw metadata response ({(rawMetadata.length / 1024).toFixed(1)} KB)
              </summary>
              <div className="px-4 pb-3 max-h-64 overflow-y-auto">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {rawMetadata.slice(0, 5000)}
                  {rawMetadata.length > 5000 && "\n\n... truncated ..."}
                </pre>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}


const MAX_VISIBLE_TAGS = 3;

function PolicyTypeTags({ types }: { types: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? types : types.slice(0, MAX_VISIBLE_TAGS);
  const overflow = types.length - MAX_VISIBLE_TAGS;

  return (
    <div className="flex flex-wrap gap-1.5 max-w-xl items-center">
      {visible.map((t) => (
        <span
          key={t}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${
            TYPE_COLORS[t] || TYPE_COLORS.other
          }`}
        >
          {POLICY_TYPE_LABELS[t] || t}
        </span>
      ))}
      {overflow > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors cursor-pointer"
        >
          +{overflow} more
        </button>
      )}
    </div>
  );
}

function ViewPdfButton({ url }: { url?: string | null }) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;

  return (
    <PillButton
      variant="primary"
      size="compact"
      onClick={() => isPdfOpen ? togglePdf() : openWithUrl(url)}
      className="hidden lg:inline-flex"
    >
      <Eye className="w-3.5 h-3.5" />
      {isPdfOpen ? "Hide PDF" : "View PDF"}
    </PillButton>
  );
}


/* ── Conversations Tab ── */
type PolicyThread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};


function PolicyConversationsTab({ conversations }: { conversations: Conversation[] | undefined }) {
  // Group into threads
  const threads = useMemo(() => {
    if (!conversations) return undefined;
    const convs = conversations as unknown as Conversation[];
    const threadMap = new Map<string, PolicyThread>();

    for (const conv of convs) {
      const rootId = (conv.threadId ?? conv._id) as string;
      const existing = threadMap.get(rootId);
      if (existing) {
        existing.messages.push(conv);
        if (conv._creationTime > existing.latestTime) existing.latestTime = conv._creationTime;
      } else {
        threadMap.set(rootId, {
          root: conv.threadId ? convs.find((c) => c._id === conv.threadId) ?? conv : conv,
          messages: [conv],
          latestTime: conv._creationTime,
        });
      }
    }

    for (const thread of threadMap.values()) {
      thread.messages.sort((a, b) => a._creationTime - b._creationTime);
    }

    return Array.from(threadMap.values()).sort((a, b) => b.latestTime - a.latestTime);
  }, [conversations]);

  if (conversations === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-12 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
        <p className="text-body-sm text-muted-foreground/50 mb-1">No conversations about this policy</p>
        <p className="text-label-sm text-muted-foreground/30">
          When Prism references this policy in email conversations, they&#39;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-foreground/6 bg-foreground/2">
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Subject</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">From</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Mode</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Messages</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const root = thread.root;
            const msgCount = thread.messages.reduce((n, m) => n + 1 + (m.responseBody ? 1 : 0), 0);
            return (
              <tr key={root._id} className="border-b border-foreground/4 last:border-0 hover:bg-foreground/[0.02] transition-colors">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/agent/thread/${root._id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {root.subject}
                  </Link>
                  <p className="text-label-sm text-muted-foreground/40 mt-0.5">
                    {dayjs(thread.latestTime).format("MMM D, YYYY")}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {root.fromName ?? root.fromEmail}
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <ModeBadge mode={root.mode} />
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground/60 tabular-nums">
                  {msgCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Activity Tab (Audit Log) ── */
const AUDIT_ACTION_CONFIG: Record<string, { icon: React.ElementType; dotColor: string; bgColor: string; title: string }> = {
  created: { icon: FileText, dotColor: "text-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/40", title: "Policy created" },
  extraction_started: { icon: Loader2, dotColor: "text-amber-500", bgColor: "bg-amber-50 dark:bg-amber-950/40", title: "Extraction started" },
  extraction_complete: { icon: CheckCircle, dotColor: "text-emerald-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/40", title: "Extraction complete" },
  extraction_error: { icon: XCircle, dotColor: "text-red-500", bgColor: "bg-red-50 dark:bg-red-950/40", title: "Extraction failed" },
  re_extraction: { icon: RefreshCw, dotColor: "text-violet-500", bgColor: "bg-violet-50 dark:bg-violet-950/40", title: "Re-extraction triggered" },
  pdf_uploaded: { icon: Upload, dotColor: "text-sky-500", bgColor: "bg-sky-50 dark:bg-sky-950/40", title: "PDF uploaded" },
  deleted: { icon: Trash2, dotColor: "text-red-400", bgColor: "bg-red-50 dark:bg-red-950/40", title: "Policy deleted" },
  restored: { icon: Shield, dotColor: "text-emerald-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/40", title: "Policy restored" },
  dismissed: { icon: XCircle, dotColor: "text-gray-500", bgColor: "bg-gray-50 dark:bg-gray-800/40", title: "Policy dismissed" },
  agent_referenced: { icon: Asterisk, dotColor: "text-[#A0D2FA]", bgColor: "bg-[#A0D2FA]/10", title: "Referenced by Prism" },
};

function PolicyActivityTab({ policyId }: { policyId: string }) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as any,
  });

  if (entries === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
          <div className="h-4 w-24 bg-foreground/5 rounded animate-pulse" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-foreground/4 last:border-b-0">
            <div className="w-7 h-7 rounded-full bg-foreground/5 animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-32 bg-foreground/5 rounded animate-pulse" />
            </div>
            <div className="h-3 w-16 bg-foreground/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-12 text-center">
        <Activity className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
        <p className="text-body-sm text-muted-foreground/50">No activity recorded yet</p>
      </div>
    );
  }

  // Group entries by date
  const groups: { label: string; entries: typeof entries }[] = [];
  for (const entry of entries) {
    const label = dayjs(entry._creationTime).format("MMMM D, YYYY");
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      {groups.map((group, gi) => {
        const config = AUDIT_ACTION_CONFIG;
        return (
          <div key={group.label}>
            {/* Date header */}
            <div className={`px-4 py-2 bg-foreground/[0.02] ${gi > 0 ? "border-t border-foreground/6" : ""} border-b border-foreground/4`}>
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </p>
            </div>

            {/* Entries */}
            {group.entries.map((entry, ei) => {
              const cfg = config[entry.action] ?? {
                icon: Activity,
                dotColor: "text-gray-500",
                bgColor: "bg-gray-50",
                title: entry.action,
              };
              const Icon = cfg.icon;
              const isLast = ei === group.entries.length - 1 && gi === groups.length - 1;

              return (
                <div
                  key={entry._id}
                  className={`flex items-start gap-3 px-4 py-3 ${!isLast ? "border-b border-foreground/4" : ""}`}
                >
                  <div className={`w-7 h-7 rounded-full ${cfg.bgColor} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`w-3.5 h-3.5 ${cfg.dotColor}`} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-body-sm font-medium text-foreground">{cfg.title}</p>
                    {entry.detail && (
                      <p className="text-label-sm text-muted-foreground/50 mt-0.5 line-clamp-1">{entry.detail}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground/35 shrink-0 pt-1 tabular-nums">
                    {dayjs(entry._creationTime).format("h:mm A")}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}


export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const policy = useQuery(api.policies.get, {
    id: id as any,
  });

  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip"
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const reExtract = useAction(api.actions.reExtractFromFile.reExtractFromFile);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [reExtracting, setReExtracting] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"details" | "conversations" | "activity" | "extraction">("details");

  const { openWithUrl } = usePdf();
  const { setPageContext } = usePageContext();
  useEffect(() => {
    if (policy) {
      const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
      });
    }
    return () => setPageContext(null);
  }, [policy, setPageContext]);
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (fileUrl && !didAutoOpen.current) {
      didAutoOpen.current = true;
      if (initialPage) {
        openWithUrl(fileUrl, initialPage);
      }
    }
  }, [fileUrl, initialPage, openWithUrl]);

  const conversations = useQuery(
    api.agentConversations.listByPolicyId,
    policy ? { policyId: policy._id } : "skip",
  );

  if (policy === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="flex items-start justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-48 mb-2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3">
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  if (policy === null) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">Policy not found</p>
          <Link href="/policies" className="text-primary hover:underline text-body-sm">
            Back to policies
          </Link>
        </div>
      </AppShell>
    );
  }

  const policyTypes: string[] = (policy as any).policyTypes ?? [(policy as any).policyType ?? "other"];
  const documentType: string = (policy as any).documentType ?? "policy";
  const security: string | undefined = (policy as any).security;
  const underwriterName: string | undefined = (policy as any).underwriter;
  const mga: string | undefined = (policy as any).mga;
  const broker: string | undefined = (policy as any).broker;
  const isDeleted = !!(policy as any).deletedAt;
  const policyDocument: any = (policy as any).document;
  const metadataSource: any = (policy as any).metadataSource;
  // Enriched fields (cl-sdk 1.2+)
  const carrierLegalName: string | undefined = (policy as any).carrierLegalName;
  const carrierNaicNumber: string | undefined = (policy as any).carrierNaicNumber;
  const carrierAmBestRating: string | undefined = (policy as any).carrierAmBestRating;
  const carrierAdmittedStatus: string | undefined = (policy as any).carrierAdmittedStatus;
  const brokerAgency: string | undefined = (policy as any).brokerAgency;
  const brokerContactName: string | undefined = (policy as any).brokerContactName;
  const brokerLicenseNumber: string | undefined = (policy as any).brokerLicenseNumber;
  const priorPolicyNumber: string | undefined = (policy as any).priorPolicyNumber;
  const programName: string | undefined = (policy as any).programName;
  const isPackage: boolean | undefined = (policy as any).isPackage;
  const insuredDba: string | undefined = (policy as any).insuredDba;
  const insuredAddress: any = (policy as any).insuredAddress;
  const insuredEntityType: string | undefined = (policy as any).insuredEntityType;
  const insuredFein: string | undefined = (policy as any).insuredFein;
  const additionalNamedInsureds: any[] | undefined = (policy as any).additionalNamedInsureds;
  const coverageForm: string | undefined = (policy as any).coverageForm;
  const retroactiveDate: string | undefined = (policy as any).retroactiveDate;
  const effectiveTime: string | undefined = (policy as any).effectiveTime;
  const limits: any = (policy as any).limits;
  const deductibles: any = (policy as any).deductibles;
  const locations: any[] | undefined = (policy as any).locations;
  const vehicles: any[] | undefined = (policy as any).vehicles;
  const classifications: any[] | undefined = (policy as any).classifications;
  const formInventory: any[] | undefined = (policy as any).formInventory;
  const taxesAndFees: any[] | undefined = (policy as any).taxesAndFees;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const result = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await result.json();
      await reExtract({ policyId: policy._id, fileId: storageId });
      toast.success("PDF uploaded, re-extracting...");
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      toast.success("Policy deleted");
      router.push("/policies");
    } catch {
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  const breadcrumbLabel = (
    <>
      {policy.carrier} {policy.policyNumber}
      {documentType === "quote" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">Quote</span>
      )}
    </>
  );

  const headerActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleUpload}
        className="hidden"
      />
      {!isDeleted && (
        <PillButton
          size="compact"
          variant="icon"
          label="Delete"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="w-4 h-4" />
        </PillButton>
      )}
      {policy.emailId && (
        <PillButton
          size="compact"
          variant="icon"
          label="Re-extract"
          disabled={reExtracting}
          onClick={async () => {
            setReExtracting(true);
            try {
              await retryExtraction({ policyId: id as any, mode: "full" });
            } finally {
              setReExtracting(false);
            }
          }}
        >
          <RefreshCw className={`w-4 h-4 ${reExtracting ? "animate-spin" : ""}`} />
        </PillButton>
      )}
      <PillButton
        size="compact"
        variant="icon"
        label="Upload"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
      </PillButton>
      <ViewPdfButton url={fileUrl} />
    </>
  );

  return (
      <AppShell breadcrumbDetail={breadcrumbLabel} actions={headerActions}>
                <FadeIn when={true} staggerIndex={0} duration={0.6}>
                  <Link
                    href="/policies"
                    className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to policies
                  </Link>

                  {isDeleted && (
                    <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5">
                      <p className="text-body-sm text-red-700 dark:text-red-400 flex-1">This policy has been deleted.</p>
                      <Button
                        variant="outline"
                        onClick={() => restorePolicy({ id: policy._id })}
                        className="text-label-sm"
                      >
                        Restore
                      </Button>
                    </div>
                  )}

                  <div className="mb-6">
                    <h1 className="!mb-0 break-all">{policy.policyNumber}</h1>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      {policy.isRenewal && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                          Renewal
                        </span>
                      )}
                      <PolicyTypeTags types={policyTypes} />
                    </div>
                  </div>
                </FadeIn>

                <Dialog open={showDeleteDialog} onOpenChange={(v) => !v && setShowDeleteDialog(false)}>
                  <DialogContent showCloseButton={false}>
                    <DialogHeader>
                      <DialogTitle>Delete Policy</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to delete <strong>{policy.policyNumber}</strong>? The policy can be restored later.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <PillButton variant="secondary" onClick={() => setShowDeleteDialog(false)} disabled={deleting}>
                        Cancel
                      </PillButton>
                      <PillButton variant="destructive" onClick={handleDelete} disabled={deleting}>
                        {deleting ? "Deleting..." : "Delete"}
                      </PillButton>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Demo data banner */}
                {(policy as any).isDemo && !demoBannerDismissed && (
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-4">
                    <p className="text-label-sm text-amber-700 dark:text-amber-400 flex-1">
                      You&apos;re viewing demo data.{" "}
                      <Link href="/profile" className="underline font-medium hover:text-amber-900">Remove demo data</Link>{" "}
                      from Settings when you&apos;re ready.
                    </p>
                    <button
                      type="button"
                      onClick={() => setDemoBannerDismissed(true)}
                      className="text-amber-500 hover:text-amber-700 transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Tab bar */}
                <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
                  {([
                    { id: "details" as const, label: "Details" },
                    { id: "conversations" as const, label: "Threads", count: conversations?.length },
                    { id: "activity" as const, label: "Activity" },
                    { id: "extraction" as const, label: "Extraction" },
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        activeTab === tab.id
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground/70"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {tab.label}
                        {tab.count != null && tab.count > 0 && (
                          <span className="text-[10px] font-medium bg-foreground/8 text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
                            {tab.count}
                          </span>
                        )}
                      </span>
                      {activeTab === tab.id && (
                        <motion.div
                          layoutId="policy-tab-indicator"
                          className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {activeTab === "details" && (<>
                <div className="flex gap-6">
                <div className="flex-1 min-w-0 @container">

                {/* Info grid */}
                <div id="section-overview" />
                <div className="flex flex-col @lg:grid @lg:grid-cols-2 @4xl:flex @4xl:flex-row gap-4 mb-6">
                  {[
                    { label: "Policy Period", value: policy.effectiveDate === "Unknown" && !policy.expirationDate
                        ? (documentType === "quote" ? "Quote" : "Unknown")
                        : (policy as any).policyTermType === "continuous"
                          ? `${policy.effectiveDate} — Until Cancelled`
                          : `${policy.effectiveDate} – ${policy.expirationDate ?? "—"}`,
                      mono: false },
                    { label: "Total Cost", value: (policy as any).totalCost || policy.premium, mono: true },
                    { label: "Insurer", value: carrierLegalName || security || policy.carrier, mono: false },
                    { label: "Insured", value: policy.insuredName, mono: false },
                    { label: "Broker", value: brokerAgency || broker, mono: false },
                  ].filter((c) => c.value).map((c, i) => (
                    <FadeIn key={c.label} when={true} staggerIndex={i + 1} duration={0.6} className="@4xl:flex-1 min-w-0">
                      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3 h-full">
                        <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{c.label}</p>
                        <p className={`text-body-sm font-medium text-foreground ${c.mono ? "font-mono" : ""}`}>{c.value}</p>
                      </div>
                    </FadeIn>
                  ))}
                </div>

                {/* Summary */}
                {policy.summary && (
                  <FadeIn when={true} delay={0.5} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3 mb-6">
                      <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        Summary
                      </p>
                      <p className="text-body-sm text-foreground leading-relaxed">
                        {policy.summary}
                      </p>
                    </div>
                  </FadeIn>
                )}

                {/* Policy Period */}
                <FadeIn when={true} delay={0.55} duration={0.6}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                    <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Policy Period
                        </p>
                        {metadataSource?.effectiveDatePage != null && <PageRef page={metadataSource.effectiveDatePage} />}
                      </div>
                    </div>
                    <table className="w-full text-left">
                      <tbody>
                        {[
                          { label: "Effective Date", value: policy.effectiveDate },
                          { label: "Expiration Date", value: policy.expirationDate ?? "—" },
                          { label: "Policy Year", value: String(policy.policyYear) },
                          effectiveTime ? { label: "Effective Time", value: effectiveTime } : null,
                          (policy as any).policyTermType ? { label: "Term Type", value: (policy as any).policyTermType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } : null,
                          coverageForm ? { label: "Coverage Form", value: coverageForm === "claims_made" ? "Claims-Made" : coverageForm === "occurrence" ? "Occurrence" : coverageForm } : null,
                          retroactiveDate ? { label: "Retroactive Date", value: retroactiveDate } : null,
                          (policy as any).nextReviewDate ? { label: "Next Review", value: (policy as any).nextReviewDate } : null,
                        ].filter(Boolean).map((item: any) => (
                          <tr key={item.label} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                            <td className="px-4 py-2 text-body-sm text-muted-foreground w-32 sm:w-48">{item.label}</td>
                            <td className="px-4 py-2 text-body-sm text-foreground font-medium">{item.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </FadeIn>

                {/* Coverages table */}
                <FadeIn when={true} delay={0.6} duration={0.6}>
                  <div id="section-coverages" className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                    <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Coverage Details
                        </p>
                      </div>
                    </div>
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-foreground/[0.02]">
                          <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Coverage
                          </th>
                          <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">
                            Limit
                          </th>
                          <th className="hidden sm:table-cell px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">
                            Deductible
                          </th>
                          <th className="hidden sm:table-cell px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right w-12">
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {policy.coverages.map((cov, i) => (
                          <FadeIn
                            key={i}
                            as="tr"
                            when={true}
                            delay={0.65 + i * 0.02}
                            duration={0.35}
                            direction="none"
                            className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                          >
                            <td className="px-4 py-2.5 text-body-sm text-foreground">
                              {cov.name}
                            </td>
                            <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right">
                              {cov.limit}
                            </td>
                            <td className="hidden sm:table-cell px-4 py-2.5 text-body-sm font-mono text-muted-foreground text-right">
                              {cov.deductible || "—"}
                            </td>
                            <td className="hidden sm:table-cell px-4 py-2.5 text-right">
                              {(cov as any).pageNumber != null && <PageRef page={(cov as any).pageNumber} />}
                            </td>
                          </FadeIn>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </FadeIn>

                {/* Parties */}
                <FadeIn when={true} delay={0.65} duration={0.6}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                    <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Parties
                        </p>
                        {metadataSource?.carrierPage != null && <PageRef page={metadataSource.carrierPage} />}
                      </div>
                    </div>
                    <table className="w-full text-left">
                      <tbody>
                        {[
                          { role: "Insured", value: policy.insuredName },
                          insuredDba ? { role: "DBA", value: insuredDba } : null,
                          insuredEntityType ? { role: "Entity Type", value: insuredEntityType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } : null,
                          insuredAddress ? { role: "Address", value: [insuredAddress.street1, insuredAddress.street2, `${insuredAddress.city}, ${insuredAddress.state} ${insuredAddress.zip}`].filter(Boolean).join(", ") } : null,
                          insuredFein ? { role: "FEIN", value: insuredFein } : null,
                          { role: "Carrier", value: carrierLegalName || security || policy.carrier },
                          carrierNaicNumber ? { role: "NAIC #", value: carrierNaicNumber } : null,
                          carrierAmBestRating ? { role: "AM Best Rating", value: carrierAmBestRating } : null,
                          carrierAdmittedStatus ? { role: "Status", value: carrierAdmittedStatus.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } : null,
                          underwriterName ? { role: "Underwriter", value: underwriterName } : null,
                          mga ? { role: "Program Administrator", value: mga } : null,
                          brokerAgency || broker ? { role: "Broker", value: brokerAgency || broker } : null,
                          brokerContactName ? { role: "Producer Contact", value: brokerContactName } : null,
                          brokerLicenseNumber ? { role: "License #", value: brokerLicenseNumber } : null,
                          programName ? { role: "Program", value: programName } : null,
                          priorPolicyNumber ? { role: "Prior Policy #", value: priorPolicyNumber } : null,
                          isPackage ? { role: "Package Policy", value: "Yes" } : null,
                        ].filter(Boolean).map((party: any, i: number) => (
                          <tr key={party.role} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                            <td className="px-4 py-2.5 text-body-sm text-muted-foreground w-32 sm:w-48">{party.role}</td>
                            <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">{party.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {additionalNamedInsureds && additionalNamedInsureds.length > 0 && (
                      <div className="px-4 py-2.5 border-t border-foreground/4">
                        <p className="text-label-sm text-muted-foreground mb-1">Additional Named Insureds</p>
                        <ul className="space-y-0.5">
                          {additionalNamedInsureds.map((ai: any, i: number) => (
                            <li key={i} className="text-body-sm text-foreground">
                              {ai.name}{ai.relationship ? ` (${ai.relationship})` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </FadeIn>

                {/* Limits Schedule */}
                {limits && (
                  <FadeIn when={true} delay={0.67} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-muted-foreground" />
                          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Limits Schedule
                          </p>
                        </div>
                      </div>
                      <table className="w-full text-left">
                        <tbody>
                          {[
                            limits.perOccurrence ? { label: "Per Occurrence", value: limits.perOccurrence } : null,
                            limits.generalAggregate ? { label: "General Aggregate", value: limits.generalAggregate } : null,
                            limits.productsCompletedOpsAggregate ? { label: "Products/Completed Ops Aggregate", value: limits.productsCompletedOpsAggregate } : null,
                            limits.personalAdvertisingInjury ? { label: "Personal & Advertising Injury", value: limits.personalAdvertisingInjury } : null,
                            limits.fireDamage ? { label: "Fire Damage", value: limits.fireDamage } : null,
                            limits.medicalExpense ? { label: "Medical Expense", value: limits.medicalExpense } : null,
                            limits.combinedSingleLimit ? { label: "Combined Single Limit", value: limits.combinedSingleLimit } : null,
                            limits.bodilyInjuryPerPerson ? { label: "Bodily Injury (Per Person)", value: limits.bodilyInjuryPerPerson } : null,
                            limits.bodilyInjuryPerAccident ? { label: "Bodily Injury (Per Accident)", value: limits.bodilyInjuryPerAccident } : null,
                            limits.propertyDamage ? { label: "Property Damage", value: limits.propertyDamage } : null,
                            limits.eachOccurrenceUmbrella ? { label: "Umbrella (Each Occurrence)", value: limits.eachOccurrenceUmbrella } : null,
                            limits.umbrellaAggregate ? { label: "Umbrella Aggregate", value: limits.umbrellaAggregate } : null,
                            limits.umbrellaRetention ? { label: "Umbrella Retention", value: limits.umbrellaRetention } : null,
                            limits.statutory ? { label: "Statutory", value: "Yes" } : null,
                            limits.defenseCostTreatment ? { label: "Defense Costs", value: limits.defenseCostTreatment.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } : null,
                          ].filter(Boolean).map((item: any) => (
                            <tr key={item.label} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                              <td className="px-4 py-2 text-body-sm text-muted-foreground w-48">{item.label}</td>
                              <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{item.value}</td>
                            </tr>
                          ))}
                          {limits.employersLiability && (
                            <>
                              <tr className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm text-muted-foreground w-48">EL - Each Accident</td>
                                <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{limits.employersLiability.eachAccident}</td>
                              </tr>
                              <tr className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm text-muted-foreground w-48">EL - Disease Policy Limit</td>
                                <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{limits.employersLiability.diseasePolicyLimit}</td>
                              </tr>
                              <tr className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm text-muted-foreground w-48">EL - Disease Each Employee</td>
                                <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{limits.employersLiability.diseaseEachEmployee}</td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </FadeIn>
                )}

                {/* Deductibles */}
                {deductibles && (
                  <FadeIn when={true} delay={0.68} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Deductibles
                          </p>
                        </div>
                      </div>
                      <table className="w-full text-left">
                        <tbody>
                          {[
                            deductibles.perOccurrence ? { label: "Per Occurrence", value: deductibles.perOccurrence } : null,
                            deductibles.perClaim ? { label: "Per Claim", value: deductibles.perClaim } : null,
                            deductibles.aggregateDeductible ? { label: "Aggregate", value: deductibles.aggregateDeductible } : null,
                            deductibles.selfInsuredRetention ? { label: "Self-Insured Retention", value: deductibles.selfInsuredRetention } : null,
                            deductibles.corridorDeductible ? { label: "Corridor", value: deductibles.corridorDeductible } : null,
                            deductibles.waitingPeriod ? { label: "Waiting Period", value: deductibles.waitingPeriod } : null,
                            deductibles.appliesTo ? { label: "Applies To", value: deductibles.appliesTo.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } : null,
                          ].filter(Boolean).map((item: any) => (
                            <tr key={item.label} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                              <td className="px-4 py-2 text-body-sm text-muted-foreground w-48">{item.label}</td>
                              <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{item.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </FadeIn>
                )}

                {/* Locations */}
                {locations && locations.length > 0 && (
                  <FadeIn when={true} delay={0.69} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Insured Locations ({locations.length})
                        </p>
                      </div>
                      {locations.map((loc: any, i: number) => (
                        <div key={i} className="px-4 py-2.5 border-t border-foreground/4 first:border-t-0">
                          <p className="text-body-sm font-medium text-foreground">
                            #{loc.number} — {loc.address.street1}, {loc.address.city}, {loc.address.state} {loc.address.zip}
                          </p>
                          {loc.description && <p className="text-body-sm text-muted-foreground mt-0.5">{loc.description}</p>}
                          {(loc.buildingValue || loc.contentsValue) && (
                            <p className="text-body-sm text-muted-foreground mt-0.5 font-mono">
                              {loc.buildingValue && `Building: ${loc.buildingValue}`}
                              {loc.buildingValue && loc.contentsValue && " | "}
                              {loc.contentsValue && `Contents: ${loc.contentsValue}`}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </FadeIn>
                )}

                {/* Vehicles */}
                {vehicles && vehicles.length > 0 && (
                  <FadeIn when={true} delay={0.69} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Insured Vehicles ({vehicles.length})
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-t border-foreground/4">
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">#</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Year</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Make/Model</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">VIN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vehicles.map((v: any, i: number) => (
                              <tr key={i} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm text-muted-foreground">{v.number}</td>
                                <td className="px-4 py-2 text-body-sm text-foreground">{v.year}</td>
                                <td className="px-4 py-2 text-body-sm text-foreground font-medium">{v.make} {v.model}</td>
                                <td className="px-4 py-2 text-body-sm font-mono text-muted-foreground">{v.vin}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </FadeIn>
                )}

                {/* Classification Codes */}
                {classifications && classifications.length > 0 && (
                  <FadeIn when={true} delay={0.69} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Classification Codes ({classifications.length})
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-t border-foreground/4">
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Code</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Description</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground text-right">Basis</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground text-right">Premium</th>
                            </tr>
                          </thead>
                          <tbody>
                            {classifications.map((cls: any, i: number) => (
                              <tr key={i} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm font-mono text-foreground">{cls.code}</td>
                                <td className="px-4 py-2 text-body-sm text-foreground">{cls.description}</td>
                                <td className="px-4 py-2 text-body-sm text-muted-foreground text-right">{cls.premiumBasis}{cls.basisAmount ? `: ${cls.basisAmount}` : ""}</td>
                                <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right">{cls.premium || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </FadeIn>
                )}

                {/* Premiums and Fees */}
                {(policy.premium || (policy as any).totalCost || (policy as any).minimumPremium || (policy as any).depositPremium || (taxesAndFees && taxesAndFees.length > 0) || policyDocument?.costsAndFees) && (
                  <FadeIn when={true} delay={0.69} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Premiums and Fees
                          </p>
                          {metadataSource?.premiumPage != null && <PageRef page={metadataSource.premiumPage} />}
                        </div>
                      </div>
                      <table className="w-full text-left">
                        <tbody>
                          {[
                            policy.premium ? { label: "Premium", value: policy.premium } : null,
                            (policy as any).totalCost && (policy as any).totalCost !== policy.premium ? { label: "Total Cost", value: (policy as any).totalCost } : null,
                            (policy as any).minimumPremium ? { label: "Minimum Premium", value: (policy as any).minimumPremium } : null,
                            (policy as any).depositPremium ? { label: "Deposit Premium", value: (policy as any).depositPremium } : null,
                          ].filter(Boolean).map((item: any) => (
                            <tr key={item.label} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                              <td className="px-4 py-2 text-body-sm text-muted-foreground">{item.label}</td>
                              <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">{item.value}</td>
                            </tr>
                          ))}
                          {taxesAndFees && taxesAndFees.length > 0 && (
                            <>
                              <tr className="border-t border-foreground/6 bg-foreground/[0.02]">
                                <td colSpan={2} className="px-4 py-1.5 text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Taxes & Fees</td>
                              </tr>
                              {taxesAndFees.map((tf: any, i: number) => (
                                <tr key={i} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                  <td className="px-4 py-2 text-body-sm text-foreground">{tf.name}{tf.type ? ` (${tf.type})` : ""}</td>
                                  <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">{tf.amount}</td>
                                </tr>
                              ))}
                            </>
                          )}
                          {policyDocument?.costsAndFees?.fees?.length > 0 && (
                            <>
                              <tr className="border-t border-foreground/6 bg-foreground/[0.02]">
                                <td colSpan={2} className="px-4 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Cost Breakdown</span>
                                    {policyDocument.costsAndFees.pageNumber != null && <PageRef page={policyDocument.costsAndFees.pageNumber} />}
                                  </div>
                                </td>
                              </tr>
                              {policyDocument.costsAndFees.fees.map((f: any, i: number) => (
                                <tr key={`cf-${i}`} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                  <td className="px-4 py-2 text-body-sm">
                                    <span className="text-foreground font-medium">{f.name}</span>
                                    {f.type && (
                                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/[0.04] text-muted-foreground">{f.type}</span>
                                    )}
                                    {f.description && (
                                      <p className="text-muted-foreground/60 text-label-sm mt-0.5">{f.description}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-body-sm font-mono font-medium text-foreground text-right align-top whitespace-nowrap">{f.amount || "—"}</td>
                                </tr>
                              ))}
                            </>
                          )}
                          {policyDocument?.costsAndFees?.content && !policyDocument?.costsAndFees?.fees?.length && (
                            <tr className="border-t border-foreground/4">
                              <td colSpan={2} className="px-4 py-2.5 text-body-sm text-foreground whitespace-pre-wrap">{policyDocument.costsAndFees.content}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </FadeIn>
                )}

                {/* Form Inventory */}
                {formInventory && formInventory.length > 0 && (
                  <FadeIn when={true} delay={0.69} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Form Inventory ({formInventory.length})
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-t border-foreground/4">
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Form #</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Edition</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Title</th>
                              <th className="px-4 py-2 text-label-sm text-muted-foreground">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {formInventory.map((f: any, i: number) => (
                              <tr key={i} className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors">
                                <td className="px-4 py-2 text-body-sm font-mono text-foreground">{f.formNumber}</td>
                                <td className="px-4 py-2 text-body-sm text-muted-foreground">{f.editionDate || "—"}</td>
                                <td className="px-4 py-2 text-body-sm text-foreground">{f.title || "—"}</td>
                                <td className="px-4 py-2 text-body-sm text-muted-foreground">{f.formType}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </FadeIn>
                )}

                {/* Document Sections */}
                {policyDocument?.sections?.length > 0 && (
                  <FadeIn when={true} delay={0.7} duration={0.6}>
                    <div id="section-document" className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
                      <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Document Sections
                          </p>
                          <span className="text-label-sm text-muted-foreground/50">
                            ({policyDocument.sections.length})
                          </span>
                        </div>
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
                  </FadeIn>
                )}

                {/* Regulatory Context / Complaint Contact / Claims Contact */}
                {(policyDocument?.regulatoryContext || policyDocument?.complaintContact || policyDocument?.claimsContact) && (
                  <div className="grid grid-cols-1 gap-4 mb-6">
                    {policyDocument.regulatoryContext && (
                      <FadeIn when={true} delay={0.75} duration={0.6}>
                        <SupplementaryCard
                          title="Regulatory Context"
                          icon={Scale}
                          pageNumber={policyDocument.regulatoryContext.pageNumber}
                          content={policyDocument.regulatoryContext.content}
                          hasStructured={!!(policyDocument.regulatoryContext.jurisdiction || policyDocument.regulatoryContext.regulatoryBody || policyDocument.regulatoryContext.governingLaw || policyDocument.regulatoryContext.details?.length)}
                        >
                          <RegulatoryContextStructured data={policyDocument.regulatoryContext} />
                        </SupplementaryCard>
                      </FadeIn>
                    )}
                    {policyDocument.complaintContact && (
                      <FadeIn when={true} delay={0.8} duration={0.6}>
                        <SupplementaryCard
                          title="Complaint Contact"
                          icon={Phone}
                          pageNumber={policyDocument.complaintContact.pageNumber}
                          content={policyDocument.complaintContact.content}
                          hasStructured={!!policyDocument.complaintContact.contacts?.length}
                        >
                          <ComplaintContactStructured contacts={policyDocument.complaintContact.contacts} />
                        </SupplementaryCard>
                      </FadeIn>
                    )}
                    {policyDocument.claimsContact && (
                      <FadeIn when={true} delay={0.9} duration={0.6}>
                        <SupplementaryCard
                          title="Claims Contact"
                          icon={AlertTriangle}
                          pageNumber={policyDocument.claimsContact.pageNumber}
                          content={policyDocument.claimsContact.content}
                          hasStructured={!!(policyDocument.claimsContact.contacts?.length || policyDocument.claimsContact.processSteps?.length || policyDocument.claimsContact.reportingTimeLimit)}
                        >
                          <ClaimsContactStructured data={policyDocument.claimsContact} />
                        </SupplementaryCard>
                      </FadeIn>
                    )}
                  </div>
                )}

                {/* Exclusions */}
                {policyDocument?.exclusions?.length > 0 && (
                  <FadeIn when={true} delay={0.85} duration={0.6}>
                    <div className="mb-6">
                      <ExclusionsCard exclusions={policyDocument.exclusions} />
                    </div>
                  </FadeIn>
                )}

                {/* Conditions */}
                {policyDocument?.conditions?.length > 0 && (
                  <FadeIn when={true} delay={0.9} duration={0.6}>
                    <div className="mb-6">
                      <CollapsibleListCard
                        id="section-conditions"
                        title="Conditions"
                        items={policyDocument.conditions}
                        getTitle={(c) => c.title}
                        getContent={(c) => c.content}
                        getPage={(c) => c.pageNumber}
                      />
                    </div>
                  </FadeIn>
                )}

                {/* Endorsements */}
                {policyDocument?.endorsements?.length > 0 && (
                  <FadeIn when={true} delay={0.95} duration={0.6}>
                    <div className="mb-6">
                      <CollapsibleListCard
                        id="section-endorsements"
                        title="Endorsements"
                        items={policyDocument.endorsements}
                        getTitle={(e) => e.title}
                        getContent={(e) => e.content}
                        getPage={(e) => e.pageStart}
                        getBadge={(e) => e.effectType ? {
                          label: e.effectType,
                          className: e.effectType === "restricts" ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                            : e.effectType === "broadens" ? "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400"
                            : "bg-foreground/5 text-muted-foreground"
                        } : undefined}
                      />
                    </div>
                  </FadeIn>
                )}
                </div>{/* end flex-1 */}

                <SectionOutline sections={[
                  { id: "section-overview", label: "Overview" },
                  { id: "section-coverages", label: "Coverages", count: policy.coverages?.length },
                  { id: "section-document", label: "Sections", count: policyDocument?.sections?.length },
                  { id: "section-exclusions", label: "Exclusions", count: policyDocument?.exclusions?.length },
                  { id: "section-conditions", label: "Conditions", count: policyDocument?.conditions?.length },
                  { id: "section-endorsements", label: "Endorsements", count: policyDocument?.endorsements?.length },
                ]} />
                </div>{/* end flex */}
                </>)}

                {activeTab === "conversations" && (
                  <PolicyConversationsTab conversations={conversations} />
                )}

                {activeTab === "activity" && (
                  <PolicyActivityTab policyId={id} />
                )}

                {activeTab === "extraction" && (
                  <ExtractionTab policy={policy} />
                )}

      </AppShell>
  );
}
