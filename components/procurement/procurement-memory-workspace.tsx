"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { Brain, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type MemoryKind =
  | "placement_preference"
  | "broker_appetite"
  | "submission_requirement"
  | "market_observation";

type MemoryRow = {
  _id: Id<"procurementMemory">;
  kind: MemoryKind;
  content: string;
  source: string;
  requestId?: Id<"procurementRequests">;
  requestTitle?: string;
  brokerName?: string;
  outreachBrokerName?: string;
  updatedByName?: string;
  updatedAt: number;
};

type RequestOption = {
  _id: Id<"procurementRequests">;
  title: string;
};

const NO_REQUEST = "__none__";
const KIND_OPTIONS: Array<{ value: MemoryKind; label: string }> = [
  { value: "placement_preference", label: "Placement preference" },
  { value: "broker_appetite", label: "Broker appetite" },
  { value: "submission_requirement", label: "Submission requirement" },
  { value: "market_observation", label: "Market observation" },
];

function kindLabel(kind: MemoryKind) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function sourceLabel(source: string) {
  if (source === "operator_agent") return "Operator agent";
  if (source === "document") return "Extracted document";
  if (source === "procurement_outcome") return "Procurement outcome";
  if (source === "mcp") return "MCP";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function MemoryDrawer({
  clientOrgId,
  memory,
  requests,
  onClose,
}: {
  clientOrgId: Id<"organizations">;
  memory?: MemoryRow;
  requests: RequestOption[];
  onClose: () => void;
}) {
  const createMemory = useMutation(api.procurementMemory.create);
  const updateMemory = useMutation(api.procurementMemory.update);
  const removeMemory = useMutation(api.procurementMemory.remove);
  const [kind, setKind] = useState<MemoryKind>(
    memory?.kind ?? "placement_preference",
  );
  const [content, setContent] = useState(memory?.content ?? "");
  const [requestId, setRequestId] = useState<string>(
    memory?.requestId ?? NO_REQUEST,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const normalized = content.trim().replace(/\s+/g, " ");

  async function save() {
    if (!normalized) {
      toast.error("Enter a durable procurement learning");
      return;
    }
    setSaving(true);
    try {
      if (memory) {
        await updateMemory({
          id: memory._id,
          kind,
          content: normalized,
          requestId:
            requestId === NO_REQUEST
              ? null
              : (requestId as Id<"procurementRequests">),
        });
        toast.success("Procurement memory updated");
      } else {
        await createMemory({
          clientOrgId,
          kind,
          content: normalized,
          requestId:
            requestId === NO_REQUEST
              ? undefined
              : (requestId as Id<"procurementRequests">),
        });
        toast.success("Procurement memory created");
      }
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to save procurement memory"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!memory) return;
    setDeleting(true);
    try {
      await removeMemory({ id: memory._id });
      toast.success("Procurement memory deleted");
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to delete procurement memory"),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving && !deleting) onClose();
      }}
      title={memory ? "Edit procurement memory" : "New procurement memory"}
      footer={
        confirmDelete ? (
          <>
            <PillButton
              variant="secondary"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              Keep memory
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete memory
            </PillButton>
          </>
        ) : (
          <>
            {memory ? (
              <PillButton
                variant="destructive"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </PillButton>
            ) : (
              <PillButton variant="secondary" onClick={onClose}>
                Cancel
              </PillButton>
            )}
            <PillButton
              disabled={!normalized || saving}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : memory ? "Save changes" : "Create memory"}
            </PillButton>
          </>
        )
      }
    >
      {confirmDelete ? (
        <OperationalPanel
          as="div"
          className="border-destructive/20 bg-destructive/5 p-4"
        >
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Delete this procurement learning?
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
          >
            The agent will no longer use it for future procurement work.
          </p>
        </OperationalPanel>
      ) : (
        <div className="space-y-5">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Kind
            </span>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as MemoryKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{kindLabel(kind)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Durable learning
            </span>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-32"
              maxLength={2_000}
              placeholder="The client prefers admitted markets when comparable terms are available."
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Related request
            </span>
            <Select
              value={requestId}
              onValueChange={(value) => value && setRequestId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {requestId === NO_REQUEST
                    ? "All procurement"
                    : (requests.find((request) => request._id === requestId)
                        ?.title ?? "Related request")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REQUEST}>All procurement</SelectItem>
                {requests.map((request) => (
                  <SelectItem key={request._id} value={request._id}>
                    {request.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      )}
    </SettingsDrawer>
  );
}

export function ProcurementMemoryWorkspace({
  clientOrgId,
  requests,
  readOnly,
  onActions,
  onRightPanel,
}: {
  clientOrgId: Id<"organizations">;
  requests: RequestOption[];
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const rows = useQuery(api.procurementMemory.list, {
    clientOrgId,
    limit: 100,
  });
  const memories = useMemo(() => (rows ?? []) as MemoryRow[], [rows]);
  const [selectedId, setSelectedId] = useState<Id<"procurementMemory"> | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const selected = memories.find((memory) => memory._id === selectedId);
  const close = useCallback(() => {
    setCreating(false);
    setSelectedId(null);
    onRightPanel(null);
  }, [onRightPanel]);

  useEffect(() => {
    onActions?.(
      readOnly ? null : (
        <PillButton type="button" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New memory
        </PillButton>
      ),
    );
    return () => onActions?.(null);
  }, [onActions, readOnly]);

  useEffect(() => {
    if (readOnly || (!creating && !selected)) {
      onRightPanel(null);
      return;
    }
    onRightPanel(
      <MemoryDrawer
        key={selected?._id ?? "new"}
        clientOrgId={clientOrgId}
        memory={selected}
        requests={requests}
        onClose={close}
      />,
    );
    return () => onRightPanel(null);
  }, [
    clientOrgId,
    close,
    creating,
    onRightPanel,
    readOnly,
    requests,
    selected,
  ]);

  if (rows === undefined) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  if (memories.length === 0) {
    return (
      <EmptyStateCard
        title="No procurement memory yet"
        description="Capture durable placement preferences, broker appetite, submission requirements, and market observations without mixing them into request status."
        icon={<Brain className="size-6" />}
        actionLabel={readOnly ? undefined : "New memory"}
        onAction={readOnly ? undefined : () => setCreating(true)}
      />
    );
  }

  return (
    <OperationalPanel as="div">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Learning</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Provenance</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {memories.map((memory) => (
            <TableRow key={memory._id}>
              <TableCell className="min-w-80 whitespace-normal">
                <span
                  className={`text-foreground ${typeStyle("body.default")}`}
                >
                  {memory.content}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{kindLabel(memory.kind)}</Badge>
              </TableCell>
              <TableCell className="min-w-44 whitespace-normal text-muted-foreground">
                <span className="block">{sourceLabel(memory.source)}</span>
                {memory.requestTitle ? (
                  <span
                    className={`mt-1 block ${typeStyle("caption.default")}`}
                  >
                    {memory.requestTitle}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDisplayDate(memory.updatedAt, "—")}
              </TableCell>
              <TableCell>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => setSelectedId(memory._id)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized"
                    aria-label="Edit procurement memory"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}
