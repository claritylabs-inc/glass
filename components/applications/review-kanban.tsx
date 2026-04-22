"use client";
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { ReviewGroupPane } from "./review-group-pane";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { useClientDetailActions } from "@/app/clients/[clientOrgId]/layout";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SectionDetailDrawer } from "./section-detail-drawer";

type Props = { applicationId: Id<"applications"> };

type SectionKey = "incomplete" | "complete";

const SECTIONS: Array<{
  key: SectionKey;
  label: string;
  statuses: Array<Doc<"applicationGroups">["status"]>;
}> = [
  { key: "incomplete", label: "Incomplete", statuses: ["not_started", "in_progress", "returned"] },
  { key: "complete", label: "Complete", statuses: ["submitted", "accepted"] },
];

export function ReviewKanban({ applicationId }: Props) {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useQuery((api as any).applications.get, { applicationId }) as {
    app: Doc<"applications">;
    groups: Doc<"applicationGroups">[];
    questions: Doc<"applicationQuestions">[];
    answers: Doc<"applicationAnswers">[];
    flags: Doc<"applicationQuestionFlags">[];
  } | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendApplication = useMutation((api as any).applications.send);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cancelApplication = useMutation((api as any).applications.cancel);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteDraft = useMutation((api as any).applications.deleteDraft);

  const [selectedGroupId, setSelectedGroupId] = useState<Id<"applicationGroups"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { setActions, setBreadcrumbExtra, setRightPanel } = useClientDetailActions();

  const app = data?.app;
  const statusLabel = app?.status.replaceAll("_", " ") ?? "";

  useEffect(() => {
    if (!app) return;
    setBreadcrumbExtra(app.title);
    return () => setBreadcrumbExtra(null);
  }, [app?.title, setBreadcrumbExtra]);

  useEffect(() => {
    if (!app) return;
    setActions(
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="secondary" className="capitalize shrink-0">
          {statusLabel}
        </Badge>
        {app.status === "draft" && (
          <>
            <PillButton
              type="button"
              size="compact"
              variant="secondary"
              onClick={handleDeleteDraft}
              disabled={submitting}
            >
              Delete draft
            </PillButton>
            <PillButton
              type="button"
              size="compact"
              variant="primary"
              onClick={handleSendApplication}
              disabled={submitting}
            >
              Send application
            </PillButton>
          </>
        )}
        {["sent", "in_progress", "awaiting_review"].includes(app.status) && (
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={handleCancelApplication}
            disabled={submitting}
          >
            Cancel application
          </PillButton>
        )}
      </div>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?._id, app?.status, statusLabel, submitting, setActions]);

  const selectedGroupResolved =
    data?.groups.find((g) => g._id === selectedGroupId) ?? null;

  useEffect(() => {
    if (!data) return;
    setRightPanel(
      <SectionDetailDrawer
        open={!!selectedGroupResolved}
        onClose={() => setSelectedGroupId(null)}
        applicationId={applicationId}
        group={selectedGroupResolved}
        questions={data.questions}
        answers={data.answers}
        flags={data.flags}
      />,
    );
    return () => setRightPanel(null);
  }, [applicationId, data, selectedGroupResolved, setRightPanel]);

  if (!data || !app) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { groups, questions, answers, flags } = data;

  const groupsBySection = SECTIONS.reduce(
    (acc, s) => {
      acc[s.key] = groups
        .filter((g) => s.statuses.includes(g.status))
        .sort((a, b) => a.order - b.order);
      return acc;
    },
    { incomplete: [], complete: [] } as Record<SectionKey, Doc<"applicationGroups">[]>,
  );

  async function handleSendApplication() {
    setSubmitting(true);
    try {
      await sendApplication({ applicationId });
      toast.success("Application sent to client");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send application");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelApplication() {
    setSubmitting(true);
    try {
      await cancelApplication({ applicationId });
      toast.success("Application cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel application");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDraft() {
    if (!app) return;
    const confirmed = window.confirm("Delete this draft application permanently?");
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await deleteDraft({ applicationId });
      toast.success("Draft deleted");
      router.push(`/clients/${app.clientOrgId}/applications`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete draft");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full space-y-4">
      {app.status === "draft" ? (
        <DraftPreview
          applicationId={applicationId}
          title={app.title}
          lineOfBusiness={app.lineOfBusiness}
          groups={groups}
          questions={questions}
          answers={answers}
        />
      ) : (
        <div className="h-full min-h-0">
          <div className="min-w-0 flex-1 overflow-y-auto space-y-6 pb-1">
            {SECTIONS.map((section) => {
              const list = groupsBySection[section.key];
              return (
                <div key={section.key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">{section.label}</h3>
                    <span className="text-xs text-muted-foreground/70">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <div className="rounded-lg border border-foreground/6 bg-card px-5 py-8 text-center text-sm text-muted-foreground/60">
                      {section.key === "incomplete"
                        ? "No incomplete sections."
                        : "No completed sections yet."}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden divide-y divide-foreground/6">
                      {list.map((g) => {
                        const openFlagCount = flags.filter(
                          (f) => f.groupId === g._id && f.status === "open",
                        ).length;
                        const qCount = questions.filter((q) => q.groupId === g._id).length;
                        const isSelected = selectedGroupId === g._id;
                        return (
                          <button
                            key={g._id}
                            type="button"
                            onClick={() => setSelectedGroupId(g._id)}
                            className={`w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left cursor-pointer transition-colors ${
                              isSelected ? "bg-muted/30" : "hover:bg-muted/20"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{g.title}</p>
                              <p className="text-xs text-muted-foreground/70 mt-0.5">
                                {qCount} question{qCount === 1 ? "" : "s"}
                                <span className="capitalize"> · {g.status.replaceAll("_", " ")}</span>
                              </p>
                            </div>
                            {openFlagCount > 0 && (
                              <Badge
                                variant="outline"
                                className="shrink-0 border-amber-400/40 bg-amber-400/10 text-xs text-amber-600"
                              >
                                {openFlagCount} flag{openFlagCount > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}

function DraftPreview({
  applicationId,
  title,
  lineOfBusiness,
  groups,
  questions,
  answers,
}: {
  applicationId: Id<"applications">;
  title: string;
  lineOfBusiness?: string;
  groups: Doc<"applicationGroups">[];
  questions: Doc<"applicationQuestions">[];
  answers: Doc<"applicationAnswers">[];
}) {
  const answerByQuestionId = useMemo(() => {
    const m = new Map<string, Doc<"applicationAnswers">>();
    for (const a of answers) {
      if (a.rowKey) continue;
      m.set(String(a.questionId), a);
    }
    return m;
  }, [answers]);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftLob, setDraftLob] = useState(lineOfBusiness ?? "");
  const [regrouping, setRegrouping] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveMeta = useMutation((api as any).applications.updateDraftMeta);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regroup = (useAction as any)((api as any).actions.applicationAuthoring.regroupAndOrderPublic) as (args: { applicationId: Id<"applications"> }) => Promise<{ groupCount: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefill = (useAction as any)((api as any).actions.applicationPrefill.prefillFromIntelligence) as (args: { applicationId: Id<"applications"> }) => Promise<{ filledCount: number; skippedCount: number }>;

  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.order - b.order),
    [questions],
  );

  const groupedQuestions = useMemo(() => {
    const byGroup = new Map<string, Doc<"applicationQuestions">[]>();
    for (const q of sortedQuestions) {
      const key = String(q.groupId);
      const arr = byGroup.get(key);
      if (arr) arr.push(q);
      else byGroup.set(key, [q]);
    }
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
    const buckets = sortedGroups
      .map((g) => ({ group: g, questions: byGroup.get(String(g._id)) ?? [] }))
      .filter((b) => b.questions.length > 0);
    const knownIds = new Set(sortedGroups.map((g) => String(g._id)));
    const orphans = sortedQuestions.filter((q) => !knownIds.has(String(q.groupId)));
    return { buckets, orphans };
  }, [groups, sortedQuestions]);

  async function commitTitle(next: string) {
    if (next === title) return;
    if (!next.trim()) {
      setDraftTitle(title);
      return;
    }
    try {
      await saveMeta({ applicationId, title: next });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save title");
      setDraftTitle(title);
    }
  }

  async function commitLob(next: string) {
    if (next === (lineOfBusiness ?? "")) return;
    try {
      await saveMeta({ applicationId, lineOfBusiness: next });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save line of business");
      setDraftLob(lineOfBusiness ?? "");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-1.5 md:col-span-2">
          <label className="text-label-sm font-medium text-muted-foreground">Title</label>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={(e) => commitTitle(e.target.value)}
            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-label-sm font-medium text-muted-foreground">Line of business</label>
          <input
            type="text"
            value={draftLob}
            onChange={(e) => setDraftLob(e.target.value)}
            onBlur={(e) => commitLob(e.target.value)}
            placeholder="CGL, Commercial Property…"
            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="!mb-0 text-sm font-medium text-foreground">Questions</h3>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {sortedQuestions.length} total{groupedQuestions.buckets.length ? ` · ${groupedQuestions.buckets.length} sections` : ""}
            </p>
          </div>
          {sortedQuestions.length > 0 && (
            <div className="flex items-center gap-2">
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                disabled={regrouping || prefilling}
                onClick={async () => {
                  setRegrouping(true);
                  try {
                    const res = await regroup({ applicationId });
                    toast.success(`Regrouped into ${res.groupCount} groups`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Regroup failed");
                  } finally {
                    setRegrouping(false);
                  }
                }}
              >
                {regrouping ? "Regrouping…" : "Regroup with AI"}
              </PillButton>
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                disabled={regrouping || prefilling}
                onClick={async () => {
                  setPrefilling(true);
                  try {
                    const res = await prefill({ applicationId });
                    toast.success(
                      `Prefilled ${res.filledCount} answers${res.skippedCount ? ` (${res.skippedCount} low-confidence skipped)` : ""}`,
                    );
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Prefill failed");
                  } finally {
                    setPrefilling(false);
                  }
                }}
              >
                {prefilling ? "Prefilling…" : "Prefill from intelligence"}
              </PillButton>
            </div>
          )}
        </div>
        {sortedQuestions.length === 0 ? (
          <div className="rounded-lg border border-foreground/6 bg-card px-5 py-10 text-center text-sm text-muted-foreground/60">
            No questions yet.
          </div>
        ) : (
          <div className="space-y-3">
            {groupedQuestions.buckets.map(({ group, questions: qs }) => {
              const id = String(group._id);
              const isOpen = !collapsed.has(id);
              return (
                <div key={group._id} className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(id)}
                    className={`w-full px-5 py-3.5 text-left flex items-start gap-3 hover:bg-muted/20 transition-colors ${isOpen ? "border-b border-foreground/6" : ""}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="!mb-0 text-sm font-medium text-foreground">{group.title}</h4>
                      {group.description && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">{group.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5">
                      {qs.length}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="divide-y divide-foreground/6">
                      {qs.map((q) => (
                        <div key={q._id} className="px-5 py-3">
                          <p className="text-sm font-medium text-foreground">{q.prompt}</p>
                          <AnswerRow
                            applicationId={applicationId}
                            questionId={q._id}
                            answer={answerByQuestionId.get(String(q._id))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {groupedQuestions.orphans.length > 0 && (() => {
              const id = "__orphans__";
              const isOpen = !collapsed.has(id);
              return (
                <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(id)}
                    className={`w-full px-5 py-3.5 text-left flex items-start gap-3 hover:bg-muted/20 transition-colors ${isOpen ? "border-b border-foreground/6" : ""}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="!mb-0 text-sm font-medium text-muted-foreground">Ungrouped</h4>
                    </div>
                    <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5">
                      {groupedQuestions.orphans.length}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="divide-y divide-foreground/6">
                      {groupedQuestions.orphans.map((q) => (
                        <div key={q._id} className="px-5 py-3">
                          <p className="text-sm font-medium text-foreground">{q.prompt}</p>
                          <AnswerRow
                            applicationId={applicationId}
                            questionId={q._id}
                            answer={answerByQuestionId.get(String(q._id))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function AnswerRow({
  applicationId,
  questionId,
  answer,
}: {
  applicationId: Id<"applications">;
  questionId: Id<"applicationQuestions">;
  answer: Doc<"applicationAnswers"> | undefined;
}) {
  const hasValue =
    !!answer && answer.value !== undefined && answer.value !== null && answer.value !== "";
  const initialValue = hasValue
    ? typeof answer!.value === "string"
      ? answer!.value
      : JSON.stringify(answer!.value)
    : "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setAnswer = useMutation((api as any).applicationAnswers.brokerSetAnswer);

  // Sync local draft when the underlying answer changes (e.g. after prefill)
  useEffect(() => {
    if (!editing) setDraft(initialValue);
  }, [initialValue, editing]);

  const isPrefill = answer?.source === "auto_prefill";

  async function commit(next: string) {
    setBusy(true);
    try {
      await setAnswer({ applicationId, questionId, value: next });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
            if (e.key === "Escape") {
              setDraft(initialValue);
              setEditing(false);
            }
          }}
          className="flex-1 rounded-md border border-foreground/8 bg-popover px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
        />
        <PillButton type="button" size="compact" variant="primary" disabled={busy} onClick={() => commit(draft)}>
          Save
        </PillButton>
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setDraft(initialValue);
            setEditing(false);
          }}
        >
          Cancel
        </PillButton>
      </div>
    );
  }

  if (!hasValue) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 cursor-text text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        Add answer…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-1 flex min-w-0 items-center gap-2 text-left cursor-text rounded-md -ml-1 px-1 py-0.5 hover:bg-muted/30 transition-colors"
      title="Click to edit"
    >
      {isPrefill && (
        <span className="shrink-0 rounded-sm bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-500/90">
          Prefilled
        </span>
      )}
      <span className="text-sm text-foreground/90 break-words">{initialValue}</span>
    </button>
  );
}
