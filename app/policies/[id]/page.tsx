"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign, Trash2, Upload, ChevronDown, ChevronRight, Loader2, RotateCw, Scale, Phone, Receipt, AlertTriangle, Users, Eye, Mail, MessageSquare, Activity, CheckCircle, XCircle, RefreshCw, Asterisk, X } from "lucide-react";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { ModeBadge } from "@/components/mode-badge";
import { MessageBubble, type Conversation } from "@/components/conversation-message";
import { Skeleton } from "@/components/ui/skeleton";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import Link from "next/link";
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
import { RetryExtractionModal } from "@/components/ui/retry-extraction-modal";
import { PdfProvider, usePdf } from "@/components/pdf-context";
import dynamic from "next/dynamic";

const PdfPanel = dynamic(
  () => import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false }
);

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 text-blue-700",
  workers_comp: "bg-orange-100 text-orange-700",
  commercial_auto: "bg-purple-100 text-purple-700",
  non_owned_auto: "bg-violet-100 text-violet-700",
  property: "bg-green-100 text-green-700",
  umbrella: "bg-sky-100 text-sky-700",
  professional_liability: "bg-amber-100 text-amber-700",
  cyber: "bg-red-100 text-red-700",
  epli: "bg-pink-100 text-pink-700",
  directors_officers: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-700",
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
  declarations: "bg-blue-50 text-blue-600",
  insuring_agreement: "bg-green-50 text-green-600",
  policy_form: "bg-cyan-50 text-cyan-600",
  endorsement: "bg-sky-50 text-sky-600",
  application: "bg-lime-50 text-lime-600",
  exclusion: "bg-red-50 text-red-600",
  condition: "bg-amber-50 text-amber-600",
  definition: "bg-purple-50 text-purple-600",
  schedule: "bg-indigo-50 text-indigo-600",
  subjectivity: "bg-orange-50 text-orange-600",
  warranty: "bg-pink-50 text-pink-600",
  notice: "bg-teal-50 text-teal-600",
  regulatory: "bg-yellow-50 text-yellow-700",
  other: "bg-gray-50 text-gray-600",
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
    <div ref={sectionRef} className={`border-t border-foreground/4 transition-colors duration-700 ${highlighted ? "bg-blue-50/60" : ""}`}>
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
    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
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

const MAX_VISIBLE_TAGS = 3;

function PolicyTypeTags({ types }: { types: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? types : types.slice(0, MAX_VISIBLE_TAGS);
  const overflow = types.length - MAX_VISIBLE_TAGS;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 max-w-xl items-center">
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

function ViewPdfButton() {
  const { fileUrl, isPdfOpen, togglePdf } = usePdf();
  if (!fileUrl) return null;

  return (
    <PillButton
      variant="primary"
      onClick={togglePdf}
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

function PolicyThreadItem({
  thread,
  isSelected,
  onSelect,
}: {
  thread: PolicyThread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const msgCount = thread.messages.reduce((n, m) => n + 1 + (m.responseBody ? 1 : 0), 0);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-foreground/4 transition-colors cursor-pointer ${
        isSelected
          ? "bg-foreground/[0.04]"
          : "hover:bg-foreground/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-body-sm font-medium text-foreground truncate flex-1">
          {thread.root.subject}
        </span>
        <ModeBadge mode={thread.root.mode} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-label-sm text-muted-foreground/50 truncate flex-1">
          {thread.root.fromName ?? thread.root.fromEmail}
        </span>
        {msgCount > 1 && (
          <span className="text-[10px] text-muted-foreground/30 shrink-0">
            {msgCount} msgs
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/30 shrink-0">
          {dayjs(thread.latestTime).format("MMM D")}
        </span>
      </div>
    </button>
  );
}

function PolicyThreadDetail({
  thread,
  onBack,
}: {
  thread: PolicyThread;
  onBack: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const prevThreadId = useRef<string | null>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNewThread = prevThreadId.current !== thread.root._id;
    prevThreadId.current = thread.root._id;
    el.scrollTo({ top: el.scrollHeight, behavior: isNewThread ? "instant" : "smooth" });
  }, [thread.root._id, thread.messages.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/4 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1 -ml-1 rounded hover:bg-foreground/5 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h4 className="!mb-0 text-body-sm font-semibold truncate">{thread.root.subject}</h4>
          <p className="text-label-sm text-muted-foreground/50 truncate">
            {thread.root.fromName ? `${thread.root.fromName} <${thread.root.fromEmail}>` : thread.root.fromEmail}
          </p>
        </div>
        <ModeBadge mode={thread.root.mode} />
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {thread.messages.map((msg) => (
          <MessageBubble key={msg._id} conv={msg} />
        ))}
      </div>
    </div>
  );
}

const CONVERSATIONS_HEIGHT_DESKTOP = "calc(100dvh - 10rem)";
const CONVERSATIONS_HEIGHT_MOBILE = "calc(100dvh - 9rem)";

function PolicyConversationsTab({ conversations }: { conversations: Conversation[] | undefined }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      if (!thread.messages.find((m) => m._id === thread.root._id)) {
        thread.messages.unshift(thread.root);
      }
    }

    return Array.from(threadMap.values()).sort((a, b) => b.latestTime - a.latestTime);
  }, [conversations]);

  const selectedThread = threads?.find(
    (t) => t.root._id === selectedId || t.messages.some((m) => m._id === selectedId),
  );

  if (conversations === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
        <p className="text-body-sm text-muted-foreground/50 mb-1">No conversations about this policy</p>
        <p className="text-label-sm text-muted-foreground/30">
          When Clarity Agent references this policy in email conversations, they&#39;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
      {/* Desktop: sidebar + detail */}
      <div className="hidden md:flex" style={{ height: CONVERSATIONS_HEIGHT_DESKTOP }}>
        {/* Thread list */}
        <div className="w-72 shrink-0 border-r border-foreground/4 flex flex-col">
          <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4 shrink-0">
            <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Threads
              <span className="ml-1.5 text-[10px] font-medium bg-foreground/8 text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
                {threads.length}
              </span>
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <PolicyThreadItem
                key={thread.root._id}
                thread={thread}
                isSelected={selectedThread?.root._id === thread.root._id}
                onSelect={() => setSelectedId(thread.root._id)}
              />
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {selectedThread ? (
            <PolicyThreadDetail
              thread={selectedThread}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Mail className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
                <p className="text-body-sm text-muted-foreground/40">
                  Select a conversation
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: stacked list or detail */}
      <div className="md:hidden flex flex-col" style={{ height: CONVERSATIONS_HEIGHT_MOBILE }}>
        {selectedThread ? (
          <div className="flex-1 min-h-0">
            <PolicyThreadDetail
              thread={selectedThread}
              onBack={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4 shrink-0">
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Threads
                <span className="ml-1.5 text-[10px] font-medium bg-foreground/8 text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
                  {threads.length}
                </span>
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.map((thread) => (
                <PolicyThreadItem
                  key={thread.root._id}
                  thread={thread}
                  isSelected={false}
                  onSelect={() => setSelectedId(thread.root._id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Activity Tab (Audit Log) ── */
const AUDIT_ACTION_CONFIG: Record<string, { icon: React.ElementType; dotColor: string; bgColor: string; title: string }> = {
  created: { icon: FileText, dotColor: "text-blue-500", bgColor: "bg-blue-50", title: "Policy created" },
  extraction_started: { icon: Loader2, dotColor: "text-amber-500", bgColor: "bg-amber-50", title: "Extraction started" },
  extraction_complete: { icon: CheckCircle, dotColor: "text-emerald-500", bgColor: "bg-emerald-50", title: "Extraction complete" },
  extraction_error: { icon: XCircle, dotColor: "text-red-500", bgColor: "bg-red-50", title: "Extraction failed" },
  re_extraction: { icon: RefreshCw, dotColor: "text-violet-500", bgColor: "bg-violet-50", title: "Re-extraction triggered" },
  pdf_uploaded: { icon: Upload, dotColor: "text-sky-500", bgColor: "bg-sky-50", title: "PDF uploaded" },
  deleted: { icon: Trash2, dotColor: "text-red-400", bgColor: "bg-red-50", title: "Policy deleted" },
  restored: { icon: Shield, dotColor: "text-emerald-500", bgColor: "bg-emerald-50", title: "Policy restored" },
  dismissed: { icon: XCircle, dotColor: "text-gray-500", bgColor: "bg-gray-50", title: "Policy dismissed" },
  agent_referenced: { icon: Asterisk, dotColor: "text-[#A0D2FA]", bgColor: "bg-[#A0D2FA]/10", title: "Referenced by Clarity Agent" },
};

function PolicyActivityTab({ policyId }: { policyId: string }) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as any,
  });

  if (entries === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
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
      <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center">
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
    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
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

function PolicyLayoutContainer({ children, panel }: { children: React.ReactNode; panel: React.ReactNode }) {
  const { isPdfOpen, fileUrl } = usePdf();
  const hasPdfPanel = isPdfOpen && !!fileUrl;

  return (
    <div className={`mx-auto px-4 md:px-8 py-6 ${hasPdfPanel ? "max-w-[108rem] flex gap-6 items-start" : "max-w-6xl"}`}>
      <div className={hasPdfPanel ? "flex-1 min-w-0" : undefined}>
        {children}
      </div>
      {panel}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"details" | "conversations" | "activity">("details");

  const conversations = useQuery(
    api.agentConversations.listByPolicyId,
    policy ? { policyId: policy._id } : "skip",
  );

  if (policy === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
            {/* Back link */}
            <Skeleton className="h-4 w-28 mb-4" />

            {/* Title + tags */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <Skeleton className="h-7 w-48 mb-2" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3 mb-6">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-4 w-full mb-1.5" />
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Coverages table */}
            <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden mb-6">
              <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                <Skeleton className="h-4 w-28" />
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-foreground/[0.02]">
                    <th className="px-4 py-2.5"><Skeleton className="h-3 w-16" /></th>
                    <th className="px-4 py-2.5 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
                    <th className="hidden sm:table-cell px-4 py-2.5 text-right"><Skeleton className="h-3 w-16 ml-auto" /></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-t border-foreground/4">
                      <td className="px-4 py-2.5"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-4 py-2.5 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (policy === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">Policy not found</p>
            <Link
              href="/policies"
              className="text-primary hover:underline text-body-sm"
            >
              Back to policies
            </Link>
          </div>
        </main>
      </div>
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

  return (
    <PdfProvider fileUrl={fileUrl ?? null} initialPage={initialPage}>
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 pb-12 md:pb-0">
          <PolicyLayoutContainer panel={<PdfPanel />}>
                <FadeIn when={true} staggerIndex={0} duration={0.6}>
                  <Link
                    href="/policies"
                    className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to policies
                  </Link>

                  {isDeleted && (
                    <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5">
                      <p className="text-body-sm text-red-700 flex-1">This policy has been deleted.</p>
                      <Button
                        variant="outline"
                        onClick={() => restorePolicy({ id: policy._id })}
                        className="text-label-sm"
                      >
                        Restore
                      </Button>
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-6">
                    <div className="min-w-0 flex-1 mr-4">
                      <div className="flex items-center gap-3 mb-1">
                        <h1 className="!mb-0 break-all">{policy.policyNumber}</h1>
                        {documentType === "quote" && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-yellow-100 text-yellow-800">
                            Quote
                          </span>
                        )}
                        {policy.isRenewal && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700">
                            Renewal
                          </span>
                        )}
                      </div>
                      <PolicyTypeTags types={policyTypes} />
                    </div>
                    <div className="hidden md:flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        onChange={handleUpload}
                        className="hidden"
                      />
                      {!isDeleted && (
                        <PillButton
                          variant="icon"
                          label="Delete"
                          onClick={() => setShowDeleteDialog(true)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </PillButton>
                      )}
                      {policy.emailId && (
                        <RetryExtractionModal
                          policyId={id}
                          hasRawResponse={!!policy.hasRawResponse}
                          hasRawMetadata={!!policy.hasRawMetadata}
                          hasDocument={!!policyDocument}
                          trigger={
                            <PillButton variant="icon" label="Re-extract">
                              <RotateCw className="w-4 h-4" />
                            </PillButton>
                          }
                        />
                      )}
                      <PillButton
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
                      <ViewPdfButton />
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
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50/60 mb-4">
                    <p className="text-label-sm text-amber-700 flex-1">
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
                    { id: "conversations" as const, label: "Conversations", count: conversations?.length },
                    { id: "activity" as const, label: "Activity" },
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
                {/* Info grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {[
                    {
                      icon: Calendar,
                      label: "Policy Period",
                      value: policy.effectiveDate === "Unknown" && policy.expirationDate === "Unknown"
                        ? (documentType === "quote" ? "Quote" : "Unknown")
                        : `${policy.effectiveDate} – ${policy.expirationDate}`,
                      sub: `Policy Year: ${policy.policyYear}`,
                    },
                    {
                      icon: DollarSign,
                      label: "Premium",
                      value: policy.premium || "—",
                      sub: "Annual premium",
                      mono: true,
                    },
                    {
                      icon: Shield,
                      label: "Producer",
                      value: policy.carrier,
                      sub: `Status: ${policy.extractionStatus}`,
                    },
                  ].map((card, i) => (
                    <FadeIn key={card.label} when={true} staggerIndex={i + 1} duration={0.6}>
                      <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3 h-full">
                        <div className="flex items-center gap-2 mb-2">
                          <card.icon className="w-4 h-4 text-muted-foreground" />
                          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
                            {card.label}
                          </p>
                        </div>
                        <p
                          className={`text-body-sm font-medium text-foreground ${card.mono ? "font-mono" : ""}`}
                        >
                          {card.value}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60 mt-1">
                          {card.sub}
                        </p>
                      </div>
                    </FadeIn>
                  ))}
                </div>

                {/* Summary */}
                {policy.summary && (
                  <FadeIn when={true} delay={0.5} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3 mb-6">
                      <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        Summary
                      </p>
                      <p className="text-body-sm text-foreground leading-relaxed">
                        {policy.summary}
                      </p>
                    </div>
                  </FadeIn>
                )}

                {/* Coverages table */}
                <FadeIn when={true} delay={0.6} duration={0.6}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden mb-6">
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
                  <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden mb-6">
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
                          { role: "Producer", value: security || policy.carrier },
                          underwriterName ? { role: "Underwriter", value: underwriterName } : null,
                          mga ? { role: "Program Administrator", value: mga } : null,
                          broker ? { role: "Broker", value: broker } : null,
                        ].filter(Boolean).map((party: any, i: number) => (
                          <tr key={party.role} className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors">
                            <td className="px-4 py-2.5 text-body-sm text-muted-foreground w-32 sm:w-48">{party.role}</td>
                            <td className="px-4 py-2.5 text-body-sm text-foreground font-medium">{party.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </FadeIn>

                {/* Document Sections */}
                {policyDocument?.sections?.length > 0 && (
                  <FadeIn when={true} delay={0.7} duration={0.6}>
                    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden mb-6">
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

                {/* Regulatory Context / Complaint Contact / Costs & Fees / Claims Contact */}
                {(policyDocument?.regulatoryContext || policyDocument?.complaintContact || policyDocument?.costsAndFees || policyDocument?.claimsContact) && (
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
                    {policyDocument.costsAndFees && (
                      <FadeIn when={true} delay={0.85} duration={0.6}>
                        <SupplementaryCard
                          title="Costs & Fees"
                          icon={Receipt}
                          pageNumber={policyDocument.costsAndFees.pageNumber}
                          content={policyDocument.costsAndFees.content}
                          hasStructured={!!policyDocument.costsAndFees.fees?.length}
                        >
                          <CostsAndFeesStructured fees={policyDocument.costsAndFees.fees} />
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
                </>)}

                {activeTab === "conversations" && (
                  <PolicyConversationsTab conversations={conversations} />
                )}

                {activeTab === "activity" && (
                  <PolicyActivityTab policyId={id} />
                )}

          </PolicyLayoutContainer>
        </main>

        <FixedMobileFooter>
          {!isDeleted && (
            <PillButton
              variant="icon"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4" />
            </PillButton>
          )}
          {policy.emailId && (
            <RetryExtractionModal
              policyId={id}
              hasRawResponse={!!policy.hasRawResponse}
              hasRawMetadata={!!policy.hasRawMetadata}
              hasDocument={!!policyDocument}
              trigger={
                <PillButton variant="icon">
                  <RotateCw className="w-4 h-4" />
                </PillButton>
              }
            />
          )}
          <PillButton
            variant="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </PillButton>
          {policy.fileId && fileUrl && (
            <PillButton
              variant="icon"
              onClick={() => window.open(fileUrl, "_blank")}
            >
              <Download className="w-4 h-4" />
            </PillButton>
          )}
        </FixedMobileFooter>

      </div>
    </PdfProvider>
  );
}
