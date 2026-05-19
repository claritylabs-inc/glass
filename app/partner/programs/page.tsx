"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ClipboardCheck, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type ApprovalMode = "auto_approve_all" | "require_approval_all" | "llm_review";

type Template = {
  _id: Id<"coiTemplates">;
  name: string;
  templateKind: string;
};

type Program = {
  _id: Id<"partnerPrograms">;
  name: string;
  aliases?: string[];
  description?: string;
  categoryLabels?: string[];
  categoryLabel?: string;
  defaultTemplateId?: Id<"coiTemplates">;
  defaultTemplate?: Template | null;
  approvalMode?: ApprovalMode;
  approvalRuleText?: string;
  status: "active" | "inactive";
  templateCount?: number;
};

const MODE_LABELS: Record<ApprovalMode, string> = {
  auto_approve_all: "Auto-approve all",
  require_approval_all: "Require approval",
  llm_review: "Agentic review",
};

const STANDARD_TEMPLATE_VALUE = "__standard_glass__";

function ProgramSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-foreground/6 bg-card">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 border-t border-foreground/4 px-4 py-3 first:border-t-0"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function addListValue(items: string[], value: string) {
  const trimmed = value.trim();
  if (!trimmed) return items;
  const exists = items.some((item) => item.toLowerCase() === trimmed.toLowerCase());
  return exists ? items : [...items, trimmed];
}

function TagListEditor({
  label,
  placeholder,
  values,
  draft,
  onDraftChange,
  onValuesChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onValuesChange: (value: string[]) => void;
}) {
  function addValue() {
    const next = addListValue(values, draft);
    onValuesChange(next);
    if (next !== values) onDraftChange("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
        />
        <PillButton type="button" variant="secondary" size="compact" onClick={addValue}>
          <Plus className="size-3.5" />
          Add
        </PillButton>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-foreground/8 bg-foreground/[0.03] px-2 text-label-sm text-foreground"
            >
              {value}
              <button
                type="button"
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onValuesChange(values.filter((item) => item !== value))}
                aria-label={`Remove ${value}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PartnerProgramsPage() {
  const programs = useQuery(api.partnerPrograms.listPrograms, {}) as Program[] | undefined;
  const templates = useQuery(api.partnerPrograms.listTemplates, {}) as Template[] | undefined;
  const saveProgram = useAction(api.partnerPrograms.saveProgram);
  const [editing, setEditing] = useState<Program | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [categoryLabels, setCategoryLabels] = useState<string[]>([]);
  const [categoryLabelDraft, setCategoryLabelDraft] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const [description, setDescription] = useState("");
  const [defaultTemplateId, setDefaultTemplateId] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("require_approval_all");
  const [approvalRuleText, setApprovalRuleText] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  const sortedTemplates = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  );

  function openEditor(program?: Program) {
    setEditing(program ?? null);
    setName(program?.name ?? "");
    setCategoryLabels(program?.categoryLabels?.length ? program.categoryLabels : program?.categoryLabel ? [program.categoryLabel] : []);
    setCategoryLabelDraft("");
    setAliases(program?.aliases ?? []);
    setAliasDraft("");
    setDescription(program?.description ?? "");
    setDefaultTemplateId(program?.defaultTemplateId ?? "");
    setApprovalMode(program?.approvalMode ?? "require_approval_all");
    setApprovalRuleText(program?.approvalRuleText ?? "");
    setStatus(program?.status ?? "active");
    setDrawerOpen(true);
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Program name is required");
      return;
    }
    setSaving(true);
    try {
      await saveProgram({
        programId: editing?._id,
        name,
        categoryLabels,
        categoryLabel: categoryLabels[0],
        aliases,
        description: description || undefined,
        defaultTemplateId: defaultTemplateId ? (defaultTemplateId as Id<"coiTemplates">) : undefined,
        approvalMode,
        approvalRuleText: approvalRuleText || undefined,
        status,
      });
      toast.success(editing ? "Program updated" : "Program created");
      setDrawerOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save program");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      breadcrumbDetail="Programs"
      actions={
        <PillButton size="compact" variant="secondary" onClick={() => openEditor()}>
          <Plus className="size-3.5" />
          New program
        </PillButton>
      }
      rightPanel={
        <SettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={editing ? "Edit program" : "New program"}
          footer={
            <PillButton disabled={saving} onClick={submit}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save program
            </PillButton>
          }
        >
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
              Program name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Startup Coverage" />
            </label>
            <TagListEditor
              label="Labels"
              placeholder="CGL, Non-Profit Liability or combined package"
              values={categoryLabels}
              draft={categoryLabelDraft}
              onDraftChange={setCategoryLabelDraft}
              onValuesChange={setCategoryLabels}
            />
            <TagListEditor
              label="Aliases"
              placeholder="Commercial GL or Startup GL"
              values={aliases}
              draft={aliasDraft}
              onDraftChange={setAliasDraft}
              onValuesChange={setAliases}
            />
            <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
              Description
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </label>
            <div className="flex flex-col gap-1.5">
              <p className="text-label-sm font-medium text-muted-foreground">Default certificate template</p>
              <Select
                value={defaultTemplateId || STANDARD_TEMPLATE_VALUE}
                onValueChange={(value) => {
                  if (!value || value === STANDARD_TEMPLATE_VALUE) {
                    setDefaultTemplateId("");
                    return;
                  }
                  setDefaultTemplateId(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {defaultTemplateId
                      ? sortedTemplates.find((template) => template._id === defaultTemplateId)?.name
                      : "Standard Glass certificate"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDARD_TEMPLATE_VALUE}>Standard Glass certificate</SelectItem>
                {sortedTemplates.map((template) => (
                  <SelectItem key={template._id} value={template._id}>
                    {template.name}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-label-sm font-medium text-muted-foreground">Certificate approval mode</p>
              <Select
                value={approvalMode}
                onValueChange={(value) => setApprovalMode(value as ApprovalMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{MODE_LABELS[approvalMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_approve_all">Auto-approve all</SelectItem>
                  <SelectItem value="require_approval_all">Always require approval</SelectItem>
                  <SelectItem value="llm_review">Agentic review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {approvalMode === "llm_review" ? (
              <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
                Agentic review instructions
                <Textarea
                  value={approvalRuleText}
                  onChange={(event) => setApprovalRuleText(event.target.value)}
                  rows={10}
                  className="min-h-44 resize-y"
                  placeholder="Describe how Glass should review certificate requests for this program. Include eligibility rules, required policy conditions, excluded classes, limit requirements and when to route the request to a program administrator."
                />
              </label>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="text-label-sm font-medium text-muted-foreground">Status</p>
              <Select value={status} onValueChange={(value) => setStatus(value as "active" | "inactive")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{status === "active" ? "Active" : "Inactive"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </SettingsDrawer>
      }
    >
      <div className="flex w-full flex-col gap-4">
        {programs === undefined ? (
          <ProgramSkeleton />
        ) : programs.length === 0 ? (
          <EmptyStateCard
            icon={<ClipboardCheck className="size-5" />}
            title="No programs yet"
            description="Create programs for lines, sublines or combined products. Glass uses program names and aliases to match certificate requests."
            actionLabel="New program"
            onAction={() => openEditor()}
          />
        ) : (
          <section className="overflow-hidden rounded-lg border border-foreground/6 bg-card">
            {programs.map((program) => (
              <button
                key={program._id}
                type="button"
                onClick={() => openEditor(program)}
                className="flex w-full items-center justify-between gap-4 border-t border-foreground/4 px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{program.name}</p>
                    <Badge variant={program.status === "active" ? "secondary" : "outline"} className="font-normal text-muted-foreground">
                      {program.status}
                    </Badge>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {MODE_LABELS[program.approvalMode ?? "require_approval_all"]}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {[
                      (program.categoryLabels?.length ? program.categoryLabels : program.categoryLabel ? [program.categoryLabel] : []).join(", "),
                      program.defaultTemplate?.name ?? "Standard Glass certificate",
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </button>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
