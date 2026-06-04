"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Moveable from "react-moveable";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import dayjs from "dayjs";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Calendar,
  Clock,
  Columns3,
  FileText,
  GripVertical,
  Hash,
  Loader2,
  Maximize2,
  Plus,
  Sparkles,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useAction, useMutation } from "convex/react";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FileDropZone } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
  OperationalPanel,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
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
import {
  useCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type TemplateKind = "standard_glass" | "pdf_overlay";

const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  standard_glass: "Standard Glass certificate",
  pdf_overlay: "Existing PDF template with fields",
};

type CoverageColumnKey =
  | "coverage_name"
  | "policy_number"
  | "effective_date"
  | "expiration_date"
  | "per_occurrence_limit"
  | "aggregate_limit"
  | "coverage_description"
  | "limits";

type CoverageTableConfig = {
  coverageMode: "all" | "llm_specified";
  coveragePrompt?: string;
  columns: CoverageColumnKey[];
  rowHeight?: number;
};

type OverlayField = {
  id: string;
  type: "data" | "static" | "custom_smart" | "coverage_table";
  key?: string;
  label: string;
  value?: string;
  customPrompt?: string;
  coverageConfig?: CoverageTableConfig;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  align: "left" | "center" | "right";
};

type OverlayFieldGeometry = Pick<OverlayField, "x" | "y" | "width" | "height">;

type OverlayFieldResizeUpdate = {
  id: string;
  patch: OverlayFieldGeometry;
};

type Template = {
  _id: Id<"coiTemplates">;
  name: string;
  templateKind: TemplateKind;
  fileId?: Id<"_storage">;
  fileName?: string;
  outputFileName?: string;
  fileUrl?: string | null;
  certifiedNotice?: string;
  fieldMappings?: { fields?: OverlayField[] };
  fallbackToStandard?: boolean;
  status: "active" | "inactive";
};

type BuilderProps = {
  open: boolean;
  fileUrl: string | null;
  fileId: string;
  fileName: string;
  fields: OverlayField[];
  selectedField: OverlayField | null;
  selectedIds: string[];
  pageElement: HTMLDivElement | null;
  selectedTargets: HTMLDivElement[];
  zoom: number;
  autoPlacing: boolean;
  onOpenChange: (open: boolean) => void;
  onAddField: (key: string, label: string) => void;
  onAddCoverageTable: () => void;
  onDropField: (field: FieldDropPayload) => void;
  onAutoPlace: () => void | Promise<void>;
  onUpdateSelected: (patch: Partial<OverlayField>) => void;
  onUpdateCoverageConfig: (patch: Partial<CoverageTableConfig>) => void;
  onRemoveSelected: () => void;
  onRecordHistory: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSelectField: (fieldId: string, target: HTMLDivElement, additive: boolean) => void;
  onSelectFields: (fields: Array<{ id: string; target: HTMLDivElement }>) => void;
  onClearSelection: () => void;
  onAlignSelected: (align: OverlayField["align"]) => void;
  onAlignSelectedFields: (align: OverlayField["align"]) => void;
  onMoveSelected: (updates: Array<{ id: string; x: number; y: number }>) => void;
  onResizeSelected: (updates: OverlayFieldResizeUpdate[]) => void;
  onPageElementChange: (node: HTMLDivElement | null) => void;
  onZoomChange: (zoom: number) => void;
};

type FieldDropPayload = {
  kind: "field" | "coverage_table" | "custom_smart";
  key: string;
  label: string;
  x: number;
  y: number;
};

type FieldDragPayload = Omit<FieldDropPayload, "x" | "y">;

type SelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type AutoPlaceTarget = {
  id: string;
  key?: string;
  label: string;
  type: OverlayField["type"];
};

type AutoPlacePlacement = AutoPlaceTarget & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AutoPlaceCandidate = {
  id: string;
  label: string;
  kind: "field" | "area";
  nearbyText: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

type AutoPlaceMatch = {
  fieldId: string;
  candidateId: string;
  confidence?: number | null;
};

type PdfTextLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

const FIELD_DRAG_MIME = "application/x-glass-certificate-field";
const MIN_BUILDER_WIDTH = 768;

const KEYBOARD_SHORTCUTS = [
  { keys: ["h", "j", "k", "l"], label: "Move" },
  { keys: ["Shift", "h", "j", "k", "l"], label: "Move 10px" },
  { keys: ["a"], label: "Select all" },
  { keys: ["d", "Delete"], label: "Delete" },
  { keys: ["Esc"], label: "Deselect" },
  { keys: ["1", "2", "3"], label: "Align fields" },
  { keys: ["q", "w", "e"], label: "Align text" },
  { keys: ["[", "]"], label: "Zoom" },
];

const COVERAGE_COLUMN_OPTIONS: Array<{ key: CoverageColumnKey; label: string }> = [
  { key: "coverage_name", label: "Coverage name" },
  { key: "policy_number", label: "Policy number" },
  { key: "effective_date", label: "Effective date" },
  { key: "expiration_date", label: "Expiration date" },
  { key: "per_occurrence_limit", label: "Per-occurrence limit" },
  { key: "aggregate_limit", label: "Aggregate limit" },
  { key: "coverage_description", label: "Coverage description" },
  { key: "limits", label: "All limits" },
];

const DEFAULT_COVERAGE_COLUMNS: CoverageColumnKey[] = [
  "coverage_name",
  "policy_number",
  "effective_date",
  "expiration_date",
  "per_occurrence_limit",
  "aggregate_limit",
];

const COVERAGE_PREVIEW_ROWS: Array<Record<CoverageColumnKey, string>> = [
  {
    coverage_name: "Commercial General Liability",
    policy_number: "MPP 998877665",
    effective_date: "2025/08/04",
    expiration_date: "2027/08/04",
    per_occurrence_limit: "$1,000,000",
    aggregate_limit: "$2,000,000",
    coverage_description: "Bodily injury, property damage, premises",
    limits: "Occ $1M / Agg $2M",
  },
  {
    coverage_name: "Stop Gap Liability",
    policy_number: "SGL 123456789",
    effective_date: "2025/08/04",
    expiration_date: "2027/08/04",
    per_occurrence_limit: "$1,000,000",
    aggregate_limit: "$1,000,000",
    coverage_description: "Bodily injury by accident or disease",
    limits: "Accident $1M / Disease $1M",
  },
];

const SMART_FIELD_GROUPS = [
  {
    label: "Policy fields",
    fields: [
      { key: "certificate_holder", label: "Certificate holder", icon: FileText },
      { key: "insured_name", label: "Insured name", icon: FileText },
      { key: "insured_address", label: "Insured address", icon: FileText },
      { key: "producer", label: "Producer", icon: FileText },
      { key: "carrier", label: "Carrier", icon: FileText },
      { key: "security_panel", label: "Security panel", icon: FileText },
      { key: "policy_number", label: "Policy number", icon: Hash },
      { key: "effective_date", label: "Effective date", icon: Calendar },
      { key: "expiration_date", label: "Expiration date", icon: Calendar },
      { key: "coverage_summary", label: "Coverage summary", icon: FileText },
      { key: "limits", label: "Limits", icon: FileText },
      { key: "certified_notice", label: "Certified notice", icon: FileText },
    ],
  },
  {
    label: "Generated fields",
    fields: [
      { key: "issued_date", label: "Issue date", icon: Calendar },
      { key: "coi_generation_time", label: "Issue time", icon: Clock },
      { key: "coi_number", label: "Certificate number / ID", icon: Hash },
    ],
  },
];

const STANDARD_FIELD_GROUP = {
  label: "Standard fields",
  fields: [{ key: "static", label: "Static text", icon: Type }],
};

const CUSTOM_SMART_FIELD = {
  key: "custom_smart",
  label: "Custom smart field",
  icon: Sparkles,
};

const AUTO_PLACE_TARGETS: Array<Omit<AutoPlaceTarget, "id">> = [
  { key: "coi_number", label: "Certificate number / ID", type: "data" },
  { key: "issued_date", label: "Issue date", type: "data" },
  { key: "policy_number", label: "Policy number", type: "data" },
  { key: "certificate_holder", label: "Certificate holder", type: "data" },
  { key: "insured_address", label: "Insured address", type: "data" },
  { key: "insured_name", label: "Insured name", type: "data" },
  { key: "carrier", label: "Carrier", type: "data" },
  { key: "security_panel", label: "Security panel", type: "data" },
  { key: "coverage_table", label: "Coverage rows", type: "coverage_table" },
];

function newField(key: string, label: string): OverlayField {
  return {
    id: `${key}-${dayjs().valueOf()}`,
    type: key === "static" ? "static" : key === "custom_smart" ? "custom_smart" : "data",
    key,
    label,
    customPrompt: key === "custom_smart" ? "" : undefined,
    page: 1,
    x: 0.12,
    y: 0.12,
    width: 0.3,
    height: 0.035,
    fontSize: 9,
    align: "left",
  };
}

function newCoverageTable(): OverlayField {
  return {
    id: `coverage_table-${dayjs().valueOf()}`,
    type: "coverage_table",
    key: "coverage_table",
    label: "Coverage rows",
    page: 1,
    x: 0.12,
    y: 0.62,
    width: 0.78,
    height: 0.18,
    fontSize: 7,
    align: "left",
    coverageConfig: {
      coverageMode: "all",
      columns: DEFAULT_COVERAGE_COLUMNS,
      rowHeight: 0.045,
    },
  };
}

function cloneOverlayFields(fields: OverlayField[]): OverlayField[] {
  return fields.map((field) => ({
    ...field,
    coverageConfig: field.coverageConfig
      ? {
          ...field.coverageConfig,
          columns: [...field.coverageConfig.columns],
        }
      : undefined,
  }));
}

function connectedFieldLabel(field: OverlayField) {
  if (field.type === "coverage_table") return "Policy coverages table";
  if (field.type === "custom_smart") return "Custom smart prompt";
  if (field.type === "static") return null;
  return field.key ?? null;
}

function multiplyPdfTransforms(left: number[], right: number[]) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function isLikelySectionHeading(text: string) {
  const normalized = text.trim();
  if (!normalized) return true;
  if (normalized.length > 42) return false;
  return normalized === normalized.toUpperCase() && /[A-Z]/.test(normalized);
}

function median(values: number[], fallback: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  return sorted[Math.floor(sorted.length / 2)] ?? fallback;
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function fieldGeometry(field: OverlayField): OverlayFieldGeometry {
  return {
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
  };
}

function inferRowBounds(lines: PdfTextLine[], line: PdfTextLine, rowHeight: number) {
  const sorted = lines.map((item) => item.y).sort((a, b) => a - b);
  const index = sorted.findIndex((value) => Math.abs(value - line.y) < 0.0001);
  const previous = index > 0 ? sorted[index - 1] : line.y - rowHeight;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : line.y + rowHeight;
  const top = (previous + line.y) / 2;
  const bottom = (line.y + next) / 2;
  return { top, bottom };
}

function buildCandidateFromLine(
  line: PdfTextLine,
  index: number,
  rowHeight: number,
  lines: PdfTextLine[],
): AutoPlaceCandidate {
  const row = inferRowBounds(lines, line, rowHeight);
  const rowPaddingY = 0.006;
  const x = clampUnit(Math.max(0.335, line.right + 0.022));
  const y = clampUnit(Math.max(row.top + rowPaddingY, line.y - 0.002));
  const bottom = clampUnit(row.bottom - rowPaddingY);
  const height = Math.min(0.031, Math.max(0.02, bottom - y));
  const right = 0.92;
  return {
    id: `candidate:${index}`,
    label: line.text,
    kind: "field",
    nearbyText: [line.text],
    x,
    y,
    width: Math.max(0.08, right - x),
    height,
  };
}

function buildCoverageAreaCandidate(lines: PdfTextLine[]): AutoPlaceCandidate | null {
  const coverageHeadingIndex = lines.findIndex((line) =>
    /products?\s+and\s+coverages?|coverages?/i.test(line.text),
  );
  if (coverageHeadingIndex < 0) return null;
  const sectionLines = lines.slice(coverageHeadingIndex + 1).filter((line) => line.y > lines[coverageHeadingIndex].y);
  if (sectionLines.length === 0) return null;
  const top = Math.min(...sectionLines.map((line) => line.y));
  const bottom = Math.max(...sectionLines.map((line) => line.bottom));
  const x = clampUnit(Math.max(0.335, Math.min(...sectionLines.map((line) => line.x)) + 0.245));
  return {
    id: "candidate:coverage-area",
    label: "Coverage detail area",
    kind: "area",
    nearbyText: sectionLines.slice(0, 8).map((line) => line.text),
    x,
    y: clampUnit(top + 0.006),
    width: Math.max(0.2, 0.92 - x),
    height: Math.min(0.2, Math.max(0.1, bottom - top - 0.01)),
  };
}

async function extractAutoPlaceCandidates(fileUrl: string): Promise<AutoPlaceCandidate[]> {
  const documentProxy = await pdfjs.getDocument(fileUrl).promise;
  const page = await documentProxy.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const viewportTransform = Array.from(viewport.transform as number[]);
  const rawItems = textContent.items as Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>;
  const textBoxes = rawItems
    .map((item) => {
      const text = item.str?.trim();
      if (!text || !item.transform) return null;
      const transform = multiplyPdfTransforms(viewportTransform, Array.from(item.transform));
      const height = Math.max(Math.abs(transform[3] ?? 0), item.height ?? 0, 8);
      const width = Math.max(Math.abs(item.width ?? 0), text.length * height * 0.45);
      const x = (transform[4] ?? 0) / viewport.width;
      const y = ((transform[5] ?? 0) - height) / viewport.height;
      return {
        text,
        x: clampUnit(x),
        y: clampUnit(y),
        width: Math.min(1, width / viewport.width),
        height: Math.min(1, height / viewport.height),
      };
    })
    .filter(Boolean) as Array<{ text: string; x: number; y: number; width: number; height: number }>;

  const lineBuckets: PdfTextLine[] = [];
  for (const item of textBoxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const existing = lineBuckets.find((line) => Math.abs(line.y - item.y) < 0.006);
    if (!existing) {
      lineBuckets.push({
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        right: item.x + item.width,
        bottom: item.y + item.height,
      });
      continue;
    }
    const right = Math.max(existing.right, item.x + item.width);
    const bottom = Math.max(existing.bottom, item.y + item.height);
    existing.text = [existing.text, item.text].join(" ").replace(/\s+/g, " ").trim();
    existing.x = Math.min(existing.x, item.x);
    existing.y = Math.min(existing.y, item.y);
    existing.right = right;
    existing.bottom = bottom;
    existing.width = right - existing.x;
    existing.height = bottom - existing.y;
  }

  const lines = lineBuckets
    .filter((line) => line.text.length > 1)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rowHeight = median(
    lines.slice(1).map((line, index) => Math.abs(line.y - (lines[index]?.y ?? line.y))).filter((value) => value > 0.012),
    0.032,
  );
  const labelCandidates = lines
    .filter((line) => !isLikelySectionHeading(line.text))
    .filter((line) => line.x < 0.55)
    .map((line, index) => buildCandidateFromLine(line, index, rowHeight, lines));
  const coverageArea = buildCoverageAreaCandidate(lines);
  return coverageArea ? [...labelCandidates, coverageArea] : labelCandidates;
}

function PdfTemplateBuilderPanel({
  open,
  fileUrl,
  fileId,
  fileName,
  fields,
  selectedField,
  selectedIds,
  pageElement,
  selectedTargets,
  zoom,
  autoPlacing,
  onOpenChange,
  onAddField,
  onAddCoverageTable,
  onDropField,
  onAutoPlace,
  onUpdateSelected,
  onUpdateCoverageConfig,
  onRemoveSelected,
  onRecordHistory,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSelectField,
  onSelectFields,
  onClearSelection,
  onAlignSelected,
  onAlignSelectedFields,
  onMoveSelected,
  onResizeSelected,
  onPageElementChange,
  onZoomChange,
}: BuilderProps) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<CoverageColumnKey | null>(null);
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const selectionMovedRef = useRef(false);
  const resizeSnapshotRef = useRef<{
    fields: Map<string, OverlayFieldGeometry>;
  } | null>(null);
  const pageWidth = Math.round(760 * zoom);
  const CustomSmartIcon = CUSTOM_SMART_FIELD.icon;
  const selectedFieldIds = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  const selectedFields = fields.filter((field) => selectedFieldIds.has(field.id));
  const commonFontSize =
    selectedFields.length > 0 && selectedFields.every((field) => field.fontSize === selectedFields[0]?.fontSize)
      ? String(selectedFields[0]?.fontSize ?? "")
      : "";
  const shouldKeepSelection = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
      target.closest("[data-pdf-field], .moveable-control-box, .moveable-control, .moveable-line"),
    );
  const isTypingTarget = useCallback((target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, [contenteditable='true'], [role='combobox']")), []);
  const selectAllFields = useCallback(() => {
    if (!pageElement) return;
    const allFields = Array.from(pageElement.querySelectorAll<HTMLDivElement>("[data-field-id]"))
      .map((target) => {
        const id = target.dataset.fieldId;
        return id ? { id, target } : null;
      })
      .filter(Boolean) as Array<{ id: string; target: HTMLDivElement }>;
    onSelectFields(allFields);
  }, [onSelectFields, pageElement]);
  const nudgeSelectedFields = useCallback((direction: "left" | "right" | "up" | "down", stepPx: number) => {
    if (!pageElement || selectedIds.length === 0) return;
    const box = pageElement.getBoundingClientRect();
    const byId = new Set(selectedIds);
    const dx = direction === "left" ? -stepPx : direction === "right" ? stepPx : 0;
    const dy = direction === "up" ? -stepPx : direction === "down" ? stepPx : 0;
    onMoveSelected(
      fields
        .filter((field) => byId.has(field.id))
        .map((field) => ({
          id: field.id,
          x: Math.min(Math.max(field.x + dx / box.width, 0), Math.max(1 - field.width, 0)),
          y: Math.min(Math.max(field.y + dy / box.height, 0), Math.max(1 - field.height, 0)),
        })),
    );
  }, [fields, onMoveSelected, pageElement, selectedIds]);
  const captureResizeSnapshot = (ids: string[]) => {
    const idSet = new Set(ids);
    const selected = fields.filter((field) => idSet.has(field.id));
    const fieldMap = new Map(selected.map((field) => [field.id, fieldGeometry(field)]));
    resizeSnapshotRef.current = {
      fields: fieldMap,
    };
  };
  const resizePatchForEvent = (
    id: string,
    event: {
      direction: number[];
      width: number;
      height: number;
      drag: { left: number; top: number };
    },
    box: DOMRect,
  ): OverlayFieldGeometry | null => {
    const snapshot = resizeSnapshotRef.current?.fields.get(id);
    const current = snapshot ?? fields.find((field) => field.id === id);
    if (!current) return null;
    const changesWidth = Math.abs(event.direction[0] ?? 0) > 0;
    const changesHeight = Math.abs(event.direction[1] ?? 0) > 0;
    return {
      width: changesWidth ? Math.max(event.width / box.width, 0.006) : current.width,
      height: changesHeight ? Math.max(event.height / box.height, 0.006) : current.height,
      x: changesWidth ? event.drag.left / box.width : current.x,
      y: changesHeight ? event.drag.top / box.height : current.y,
    };
  };
  const writeDragPayload = (
    event: React.DragEvent<HTMLElement>,
    payload: FieldDragPayload,
  ) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(FIELD_DRAG_MIME, JSON.stringify(payload));
  };
  const startSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!pageElement || event.button !== 0 || shouldKeepSelection(event.target)) return;
    const pageBox = pageElement.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - pageBox.left, 0), pageBox.width);
    const y = Math.min(Math.max(event.clientY - pageBox.top, 0), pageBox.height);

    event.preventDefault();
    selectionOriginRef.current = { x, y };
    selectionMovedRef.current = false;
    setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
    onClearSelection();
  };
  const dropField = (event: React.DragEvent<HTMLDivElement>) => {
    const rawPayload = event.dataTransfer.getData(FIELD_DRAG_MIME);
    if (!pageElement || !rawPayload) return;
    event.preventDefault();
    const pageBox = pageElement.getBoundingClientRect();
    const payload = JSON.parse(rawPayload) as FieldDragPayload;
    onDropField({
      ...payload,
      x: Math.min(Math.max((event.clientX - pageBox.left) / pageBox.width, 0.01), 0.96),
      y: Math.min(Math.max((event.clientY - pageBox.top) / pageBox.height, 0.01), 0.96),
    });
  };
  const selectedCoverageColumns =
    selectedField?.coverageConfig?.columns && selectedField.coverageConfig.columns.length > 0
      ? selectedField.coverageConfig.columns
      : DEFAULT_COVERAGE_COLUMNS;
  const inactiveCoverageColumns = COVERAGE_COLUMN_OPTIONS.filter(
    (column) => !selectedCoverageColumns.includes(column.key),
  );
  const moveCoverageColumn = (targetColumn: CoverageColumnKey) => {
    if (!draggedColumn || draggedColumn === targetColumn) return;
    const withoutDragged = selectedCoverageColumns.filter((column) => column !== draggedColumn);
    const targetIndex = withoutDragged.indexOf(targetColumn);
    if (targetIndex < 0) return;
    const nextColumns = [...withoutDragged];
    nextColumns.splice(targetIndex, 0, draggedColumn);
    onUpdateCoverageConfig({ columns: nextColumns });
    setDraggedColumn(null);
  };

  useEffect(() => {
    if (!selectionBox || !pageElement) return;

    const handleMouseMove = (event: MouseEvent) => {
      const origin = selectionOriginRef.current;
      if (!origin) return;
      const pageBox = pageElement.getBoundingClientRect();
      const currentX = Math.min(Math.max(event.clientX - pageBox.left, 0), pageBox.width);
      const currentY = Math.min(Math.max(event.clientY - pageBox.top, 0), pageBox.height);
      if (Math.abs(currentX - origin.x) > 4 || Math.abs(currentY - origin.y) > 4) {
        selectionMovedRef.current = true;
      }
      setSelectionBox({ startX: origin.x, startY: origin.y, currentX, currentY });
    };

    const handleMouseUp = () => {
      const box = selectionBox;
      const pageBox = pageElement.getBoundingClientRect();
      const left = Math.min(box.startX, box.currentX);
      const right = Math.max(box.startX, box.currentX);
      const top = Math.min(box.startY, box.currentY);
      const bottom = Math.max(box.startY, box.currentY);

      if (selectionMovedRef.current) {
        const selected = Array.from(pageElement.querySelectorAll<HTMLDivElement>("[data-field-id]"))
          .map((target) => {
            const rect = target.getBoundingClientRect();
            const fieldRect = {
              left: rect.left - pageBox.left,
              right: rect.right - pageBox.left,
              top: rect.top - pageBox.top,
              bottom: rect.bottom - pageBox.top,
            };
            const intersects =
              fieldRect.left < right &&
              fieldRect.right > left &&
              fieldRect.top < bottom &&
              fieldRect.bottom > top;
            const id = target.dataset.fieldId;
            return intersects && id ? { id, target } : null;
          })
          .filter(Boolean) as Array<{ id: string; target: HTMLDivElement }>;
        onSelectFields(selected);
      }

      selectionOriginRef.current = null;
      selectionMovedRef.current = false;
      setSelectionBox(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSelectFields, pageElement, selectionBox]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const nudgeStep = event.shiftKey ? 10 : 1;

      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "a") {
        event.preventDefault();
        selectAllFields();
        return;
      }

      if (key === "a" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        selectAllFields();
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        onClearSelection();
        return;
      }

      if ((key === "delete" || key === "backspace" || key === "d") && selectedIds.length > 0) {
        event.preventDefault();
        onRemoveSelected();
        return;
      }

      if (["h", "j", "k", "l"].includes(key) && selectedIds.length > 0) {
        event.preventDefault();
        onRecordHistory();
        const direction =
          key === "h" ? "left" : key === "l" ? "right" : key === "k" ? "up" : "down";
        nudgeSelectedFields(direction, nudgeStep);
        return;
      }

      if (key === "[" || key === "]") {
        event.preventDefault();
        const delta = key === "[" ? -0.1 : 0.1;
        onZoomChange(Math.min(1.4, Math.max(0.6, Number((zoom + delta).toFixed(1)))));
        return;
      }

      if (selectedIds.length > 0 && (key === "q" || key === "w" || key === "e")) {
        event.preventDefault();
        onAlignSelected(key === "q" ? "left" : key === "w" ? "center" : "right");
        return;
      }

      if (selectedIds.length > 1 && (key === "1" || key === "2" || key === "3")) {
        event.preventDefault();
        onAlignSelectedFields(key === "1" ? "left" : key === "2" ? "center" : "right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fields,
    isTypingTarget,
    nudgeSelectedFields,
    onAlignSelected,
    onAlignSelectedFields,
    onClearSelection,
    onMoveSelected,
    onRecordHistory,
    onRedo,
    onRemoveSelected,
    onSelectFields,
    onUndo,
    onZoomChange,
    open,
    pageElement,
    selectAllFields,
    selectedIds,
    zoom,
  ]);

  if (!open) return null;
  const canAutoPlace = Boolean(fileId) && !autoPlacing;

  return (
    <div className="fixed inset-0 z-50 flex bg-background">
      <style jsx global>{`
        .moveable-control {
          background: #111111 !important;
          border-color: #ffffff !important;
          width: 8px !important;
          height: 8px !important;
          margin-left: -4px !important;
          margin-top: -4px !important;
        }
        .moveable-line {
          background: #111111 !important;
        }
        .moveable-control-box {
          z-index: 20 !important;
        }
      `}</style>
      <div className="flex h-full w-76 shrink-0 flex-col border-r border-foreground/6 bg-card">
        <div className="flex h-12 items-center gap-3 border-b border-foreground/6 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium text-foreground">PDF field builder</p>
            <p className="truncate text-label text-muted-foreground/60">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-foreground/4 hover:text-foreground"
            aria-label="Close builder"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            <div>
              <div className="flex flex-col gap-4">
                {SMART_FIELD_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1.5 text-label font-medium text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="grid gap-1">
                      {group.fields.map((field) => {
                        const Icon = field.icon;
                        return (
                          <button
                            key={field.key}
                            type="button"
                            draggable
                            onDragStart={(event) =>
                              writeDragPayload(event, {
                                kind: "field",
                                key: field.key,
                                label: field.label,
                              })
                            }
                            onClick={() => onAddField(field.key, field.label)}
                            className="group flex h-8 w-full items-center gap-2 rounded-md bg-foreground/[0.035] px-2 text-left text-base text-foreground transition-colors hover:bg-foreground/[0.06]"
                          >
                            <Icon className="size-3.5 text-muted-foreground/70" />
                            <span className="min-w-0 flex-1 truncate">{field.label}</span>
                            <GripVertical className="size-3.5 text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div>
                  <p className="mb-1.5 text-label font-medium text-muted-foreground">
                    {STANDARD_FIELD_GROUP.label}
                  </p>
                  <div className="grid gap-1">
                    {STANDARD_FIELD_GROUP.fields.map((field) => {
                      const Icon = field.icon;
                      return (
                        <button
                          key={field.key}
                          type="button"
                          draggable
                          onDragStart={(event) =>
                            writeDragPayload(event, {
                              kind: "field",
                              key: field.key,
                              label: field.label,
                            })
                          }
                          onClick={() => onAddField(field.key, field.label)}
                          className="group flex h-8 w-full items-center gap-2 rounded-md bg-foreground/[0.035] px-2 text-left text-base text-foreground transition-colors hover:bg-foreground/[0.06]"
                        >
                          <Icon className="size-3.5 text-muted-foreground/70" />
                          <span className="min-w-0 flex-1 truncate">{field.label}</span>
                          <GripVertical className="size-3.5 text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-label font-medium text-muted-foreground">
                    Smart areas
                  </p>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      writeDragPayload(event, {
                        kind: "custom_smart",
                        key: CUSTOM_SMART_FIELD.key,
                        label: CUSTOM_SMART_FIELD.label,
                      })
                    }
                    onClick={() => onAddField(CUSTOM_SMART_FIELD.key, CUSTOM_SMART_FIELD.label)}
                    className="group mb-1 flex h-8 w-full items-center gap-2 rounded-md bg-foreground/[0.035] px-2 text-left text-base text-foreground transition-colors hover:bg-foreground/[0.06]"
                  >
                    <CustomSmartIcon className="size-3.5 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1 truncate">{CUSTOM_SMART_FIELD.label}</span>
                    <GripVertical className="size-3.5 text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      writeDragPayload(event, {
                        kind: "coverage_table",
                        key: "coverage_table",
                        label: "Coverage rows",
                      })
                    }
                    onClick={onAddCoverageTable}
                    className="group flex h-8 w-full items-center gap-2 rounded-md bg-foreground/[0.035] px-2 text-left text-base text-foreground transition-colors hover:bg-foreground/[0.06]"
                  >
                    <Columns3 className="size-3.5 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1 truncate">Coverage rows table</span>
                    <GripVertical className="size-3.5 text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-foreground/[0.025]">
        <div className="flex h-12 items-center justify-between border-b border-foreground/6 bg-background px-4">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">{fileName}</p>
            <p className="text-label text-muted-foreground/60">{fields.length} placed fields</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center rounded-lg border border-foreground/8 bg-card">
              <button
                type="button"
                className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onZoomChange(Math.max(0.6, Number((zoom - 0.1).toFixed(1))))}
                aria-label="Zoom out"
              >
                <ZoomOut className="size-3.5" />
              </button>
              <span className="w-12 text-center text-label text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onZoomChange(Math.min(1.4, Number((zoom + 0.1).toFixed(1))))}
                aria-label="Zoom in"
              >
                <ZoomIn className="size-3.5" />
              </button>
            </div>
            <div className="h-6 w-px bg-foreground/10" />
            <PillButton
              type="button"
              variant="secondary"
              size="compact"
              disabled={!canAutoPlace}
              onClick={() => void onAutoPlace()}
            >
              {autoPlacing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {autoPlacing ? "Placing..." : "Auto-place"}
            </PillButton>
            <PillButton type="button" size="compact" onClick={() => onOpenChange(false)}>
              Done
            </PillButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-8 py-10">
          {fileUrl ? (
            <div className="mx-auto w-fit border border-foreground/8 bg-white shadow-sm">
              <div
                ref={onPageElementChange}
                className="relative bg-white select-none [&_canvas]:pointer-events-none [&_canvas]:select-none"
                onMouseDown={startSelection}
                onDragOver={(event) => {
                  if (Array.from(event.dataTransfer.types).includes(FIELD_DRAG_MIME)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={dropField}
              >
                <Document file={fileUrl} loading={<Skeleton className="h-[840px] w-[640px]" />}>
                  <Page pageNumber={1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
                {fields.map((field) => (
                  <div
                    key={field.id}
                    role="button"
                    tabIndex={0}
                    data-pdf-field="true"
                    data-field-id={field.id}
                    onClick={(event) => onSelectField(field.id, event.currentTarget, event.shiftKey || event.metaKey)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onSelectField(field.id, event.currentTarget, event.shiftKey || event.metaKey);
                    }}
                    className={`group absolute flex items-center truncate border px-1 text-label shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-colors ${
                      selectedFieldIds.has(field.id)
                        ? "border-foreground bg-background text-foreground"
                        : field.type === "static"
                          ? "border-dashed border-foreground/25 bg-background/70 text-muted-foreground hover:border-foreground/45 hover:text-foreground"
                          : "border-foreground/18 bg-background/80 text-muted-foreground hover:border-foreground/45 hover:text-foreground"
                    }`}
                    style={{
                      left: `${field.x * 100}%`,
                      top: `${field.y * 100}%`,
                      width: `${field.width * 100}%`,
                      height: `${field.height * 100}%`,
                      fontSize: field.fontSize,
                      justifyContent:
                        field.align === "center"
                          ? "center"
                          : field.align === "right"
                            ? "flex-end"
                            : "flex-start",
                    }}
                  >
                    <GripVertical className="mr-1 hidden size-3 shrink-0 text-muted-foreground/50 group-hover:block" />
                    <span className="min-w-0 flex-1 truncate">{field.label}</span>
                    {selectedFieldIds.has(field.id) ? (
                      <span className="ml-1 flex shrink-0 items-center gap-0.5 rounded bg-background/95">
                        <button
                          type="button"
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAlignSelected("left");
                          }}
                          aria-label="Align left"
                        >
                          <AlignLeft className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAlignSelected("center");
                          }}
                          aria-label="Align center"
                        >
                          <AlignCenter className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAlignSelected("right");
                          }}
                          aria-label="Align right"
                        >
                          <AlignRight className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveSelected();
                          }}
                          aria-label="Delete field"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    ) : null}
                  </div>
                ))}
                {hasSelection && pageElement ? (
                  <Moveable
                    target={selectedTargets}
                    container={pageElement}
                    flushSync={flushSync}
                    draggable
                    resizable
                    keepRatio={false}
                    throttleDrag={0}
                    throttleResize={0}
                    onDragStart={() => {
                      onRecordHistory();
                    }}
                    onDrag={({ target, left, top }) => {
                      const box = pageElement.getBoundingClientRect();
                      const id = (target as HTMLElement).dataset.fieldId;
                      if (!box || !id) return;
                      onMoveSelected([{ id, x: left / box.width, y: top / box.height }]);
                    }}
                    onDragGroup={({ events }) => {
                      const box = pageElement.getBoundingClientRect();
                      if (!box) return;
                      onMoveSelected(
                        events
                          .map((event) => {
                            const id = (event.target as HTMLElement).dataset.fieldId;
                            return id ? { id, x: event.left / box.width, y: event.top / box.height } : null;
                          })
                          .filter(Boolean) as Array<{ id: string; x: number; y: number }>,
                      );
                    }}
                    onDragGroupStart={() => {
                      onRecordHistory();
                    }}
                    onResizeStart={({ direction, startRatio, setRatio }) => {
                      onRecordHistory();
                      captureResizeSnapshot(selectedIds);
                      if (Math.abs(direction[0] ?? 0) > 0 && Math.abs(direction[1] ?? 0) > 0) {
                        setRatio(startRatio);
                      }
                    }}
                    onResizeEnd={() => {
                      resizeSnapshotRef.current = null;
                    }}
                    onResize={({ target, direction, width, height, drag }) => {
                      const box = pageElement.getBoundingClientRect();
                      const id = (target as HTMLElement).dataset.fieldId;
                      if (!box || !id) return;
                      const patch = resizePatchForEvent(id, {
                        direction,
                        width,
                        height,
                        drag,
                      }, box);
                      if (!patch) return;
                      onResizeSelected([{ id, patch }]);
                    }}
                    onResizeGroupStart={({ direction, startRatio, setRatio }) => {
                      onRecordHistory();
                      captureResizeSnapshot(selectedIds);
                      if (Math.abs(direction[0] ?? 0) > 0 && Math.abs(direction[1] ?? 0) > 0) {
                        setRatio(startRatio);
                      }
                    }}
                    onResizeGroupEnd={() => {
                      resizeSnapshotRef.current = null;
                    }}
                    onResizeGroup={({ events }) => {
                      const box = pageElement.getBoundingClientRect();
                      if (!box) return;
                      onResizeSelected(
                        events
                          .map((event) => {
                            const id = (event.target as HTMLElement).dataset.fieldId;
                            if (!id) return null;
                            const patch = resizePatchForEvent(id, {
                              direction: event.direction,
                              width: event.width,
                              height: event.height,
                              drag: event.drag,
                            }, box);
                            return patch ? { id, patch } : null;
                          })
                          .filter(Boolean) as OverlayFieldResizeUpdate[],
                      );
                    }}
                  />
                ) : null}
                {selectionBox ? (
                  <div
                    className="pointer-events-none absolute z-30 border border-foreground bg-foreground/[0.04]"
                    style={{
                      left: Math.min(selectionBox.startX, selectionBox.currentX),
                      top: Math.min(selectionBox.startY, selectionBox.currentY),
                      width: Math.abs(selectionBox.currentX - selectionBox.startX),
                      height: Math.abs(selectionBox.currentY - selectionBox.startY),
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex h-full w-80 shrink-0 flex-col border-l border-foreground/6 bg-card">
        <div className="flex h-12 items-center border-b border-foreground/6 px-4">
          <p className="text-base font-medium text-foreground">Properties</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selectedIds.length > 1 ? (
            <div className="flex flex-col gap-3">
              <p className="text-base font-medium text-foreground">{selectedIds.length} fields selected</p>
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Font size
                <Input
                  type="number"
                  min={6}
                  max={24}
                  value={commonFontSize}
                  placeholder="Mixed"
                  onChange={(event) => {
                    const fontSize = Number(event.target.value);
                    if (Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 24) {
                      onUpdateSelected({ fontSize });
                    }
                  }}
                />
              </label>
              <div>
                <p className="mb-1.5 text-label font-medium text-muted-foreground">Field position</p>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((align) => {
                    const Icon = align === "left" ? AlignLeft : align === "center" ? AlignCenter : AlignRight;
                    return (
                      <button
                        key={align}
                        type="button"
                        className="flex h-8 flex-1 items-center justify-center rounded-md border border-foreground/8 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => onAlignSelectedFields(align)}
                        aria-label={`Align field boxes ${align}`}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-label font-medium text-muted-foreground">Text alignment</p>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((align) => {
                    const Icon = align === "left" ? AlignLeft : align === "center" ? AlignCenter : AlignRight;
                    return (
                      <button
                        key={align}
                        type="button"
                        className="flex h-8 flex-1 items-center justify-center rounded-md border border-foreground/8 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => onAlignSelected(align)}
                        aria-label={`Align selected text ${align}`}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <PillButton type="button" variant="destructive" size="compact" onClick={onRemoveSelected}>
                <Trash2 className="size-3.5" />
                Delete selected
              </PillButton>
            </div>
          ) : selectedField ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Label
                <Input
                  value={selectedField.label}
                  onChange={(event) => onUpdateSelected({ label: event.target.value })}
                />
              </label>
              {connectedFieldLabel(selectedField) ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-label font-medium text-muted-foreground">Connected data</p>
                  <div className="rounded-md border border-foreground/8 bg-background px-2 py-1.5 font-mono text-label text-muted-foreground">
                    {connectedFieldLabel(selectedField)}
                  </div>
                </div>
              ) : null}
              {selectedField.key === "static" ? (
                <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                  Static text
                  <Textarea
                    value={selectedField.value ?? ""}
                    onChange={(event) => onUpdateSelected({ type: "static", value: event.target.value })}
                    rows={3}
                  />
                </label>
              ) : null}
              {selectedField.type === "custom_smart" ? (
                <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                  Autofill prompt
                  <Textarea
                    value={selectedField.customPrompt ?? ""}
                    onChange={(event) => onUpdateSelected({ customPrompt: event.target.value })}
                    rows={4}
                    placeholder="Example: Summarize only the additional insured endorsement status in 12 words or fewer."
                  />
                  <span className="text-label font-normal leading-5 text-muted-foreground/60">
                    Glass fills this from the policy and certificate data when generating the PDF. Keep the prompt narrow and specify formatting.
                  </span>
                </label>
              ) : null}
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Font size
                <Input
                  type="number"
                  min={6}
                  max={24}
                  value={selectedField.fontSize}
                  onChange={(event) => onUpdateSelected({ fontSize: Number(event.target.value) })}
                />
              </label>
              <div>
                <p className="mb-1.5 text-label font-medium text-muted-foreground">Alignment</p>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((align) => {
                    const Icon = align === "left" ? AlignLeft : align === "center" ? AlignCenter : AlignRight;
                    return (
                      <button
                        key={align}
                        type="button"
                        className={`flex h-8 flex-1 items-center justify-center rounded-md border transition-colors ${
                          selectedField.align === align
                            ? "border-foreground/20 bg-foreground/[0.04] text-foreground"
                            : "border-foreground/8 text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => onAlignSelected(align)}
                        aria-label={`Align ${align}`}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedField.type === "coverage_table" ? (
                <div className="flex flex-col gap-3 border-t border-foreground/6 pt-4">
                  <p className="text-base font-medium text-foreground">Coverage table</p>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-label font-medium text-muted-foreground">Coverages to show</p>
                    <Select
                      value={selectedField.coverageConfig?.coverageMode ?? "all"}
                      onValueChange={(value) =>
                        onUpdateCoverageConfig({ coverageMode: value as CoverageTableConfig["coverageMode"] })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(selectedField.coverageConfig?.coverageMode ?? "all") === "all"
                            ? "Show all coverages"
                            : "Specific coverages"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Show all coverages</SelectItem>
                        <SelectItem value="llm_specified">Specific coverages</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(selectedField.coverageConfig?.coverageMode ?? "all") === "llm_specified" ? (
                    <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                      Coverage instruction
                      <Textarea
                        value={selectedField.coverageConfig?.coveragePrompt ?? ""}
                        onChange={(event) => onUpdateCoverageConfig({ coveragePrompt: event.target.value })}
                        rows={3}
                        placeholder="Example: general liability only"
                      />
                    </label>
                  ) : null}
                  <div>
                    <p className="mb-1.5 text-label font-medium text-muted-foreground">Columns</p>
                    <div className="grid gap-1">
                      {selectedCoverageColumns.map((columnKey) => {
                        const column = COVERAGE_COLUMN_OPTIONS.find((option) => option.key === columnKey);
                        if (!column) return null;
                        return (
                          <div
                            key={column.key}
                            draggable
                            onDragStart={() => setDraggedColumn(column.key)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => moveCoverageColumn(column.key)}
                            onDragEnd={() => setDraggedColumn(null)}
                            className={`flex h-8 items-center gap-2 rounded-md border px-2 text-label transition-colors ${
                              draggedColumn === column.key
                                ? "border-foreground/20 bg-foreground/[0.06] text-foreground"
                                : "border-foreground/8 bg-foreground/[0.035] text-foreground"
                            }`}
                          >
                            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/45" />
                            <span className="min-w-0 flex-1 truncate">{column.label}</span>
                            <button
                              type="button"
                              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                              onClick={() => {
                                const next = selectedCoverageColumns.filter((item) => item !== column.key);
                                onUpdateCoverageConfig({ columns: next.length > 0 ? next : selectedCoverageColumns });
                              }}
                              aria-label={`Remove ${column.label}`}
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {inactiveCoverageColumns.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {inactiveCoverageColumns.map((column) => (
                          <button
                            key={column.key}
                            type="button"
                            className="flex h-7 items-center rounded-md border border-foreground/8 px-2 text-label text-muted-foreground transition-colors hover:text-foreground"
                            onClick={() =>
                              onUpdateCoverageConfig({
                                columns: [...selectedCoverageColumns, column.key],
                              })
                            }
                          >
                            <Plus className="mr-1 size-3" />
                            {column.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <p className="mb-1.5 text-label font-medium text-muted-foreground">Preview</p>
                    <div className="overflow-x-auto rounded-md border border-foreground/8 bg-background">
                      <table className="min-w-full border-collapse text-left text-label">
                        <thead>
                          <tr className="border-b border-foreground/8 bg-foreground/[0.035]">
                            {selectedCoverageColumns.map((columnKey) => {
                              const column = COVERAGE_COLUMN_OPTIONS.find((option) => option.key === columnKey);
                              return (
                                <th
                                  key={columnKey}
                                  className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground"
                                >
                                  {column?.label ?? columnKey}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {COVERAGE_PREVIEW_ROWS.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-b border-foreground/6 last:border-b-0">
                              {selectedCoverageColumns.map((columnKey) => (
                                <td
                                  key={columnKey}
                                  className="max-w-28 truncate px-2 py-1.5 text-muted-foreground"
                                >
                                  {row[columnKey]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
              <PillButton type="button" variant="destructive" size="compact" onClick={onRemoveSelected}>
                <Trash2 className="size-3.5" />
                Remove field
              </PillButton>
            </div>
          ) : (
            <div className="rounded-lg border border-foreground/6 bg-background p-3 text-base text-muted-foreground">
              Select a field to configure it.
            </div>
          )}
        </div>
        <div className="border-t border-foreground/6 px-4 py-3">
          <p className="text-label font-medium text-muted-foreground">Keyboard shortcuts</p>
          <div className="mt-2 grid gap-1.5">
            {[
              { label: "Undo", keys: ["Cmd", "Z"], enabled: canUndo },
              { label: "Redo", keys: ["Cmd", "Shift", "Z"], enabled: canRedo },
            ].map((shortcut) => (
              <div
                key={shortcut.label}
                className={`flex min-h-6 items-center justify-between gap-3 ${
                  shortcut.enabled ? "" : "opacity-45"
                }`}
              >
                <span className="shrink-0 text-label text-muted-foreground/65">{shortcut.label}</span>
                <span className="flex min-w-0 flex-wrap justify-end gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={`${shortcut.label}-${key}`}
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-foreground/8 bg-background px-1.5 font-mono text-label leading-none text-muted-foreground"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
            {KEYBOARD_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.label} className="flex min-h-6 items-center justify-between gap-3">
                <span className="shrink-0 text-label text-muted-foreground/65">{shortcut.label}</span>
                <span className="flex min-w-0 flex-wrap justify-end gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={`${shortcut.label}-${key}`}
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-foreground/8 bg-background px-1.5 font-mono text-label leading-none text-muted-foreground"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PartnerTemplatesPage() {
  const templates = useCachedQuery(
    "partnerPrograms.listTemplates",
    api.partnerPrograms.listTemplates,
    {},
  ) as Template[] | undefined;
  const autoPlaceTemplateFields = useAction(api.partnerPrograms.autoPlaceTemplateFields);
  const generateUploadUrl = useMutation(api.partnerPrograms.generateTemplateUploadUrl);
  const saveTemplate = useMutation(api.partnerPrograms.createTemplate);
  const upsertTemplates = useUpsertCachedQuery<
    Template[],
    Record<string, never>
  >("partnerPrograms.listTemplates");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [currentTemplateId, setCurrentTemplateId] = useState<Id<"coiTemplates"> | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("standard_glass");
  const [fileId, setFileId] = useState("");
  const [fileName, setFileName] = useState("");
  const [outputFileName, setOutputFileName] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [certifiedNotice, setCertifiedNotice] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [fields, setFields] = useState<OverlayField[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageElement, setPageElement] = useState<HTMLDivElement | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<HTMLDivElement[]>([]);
  const [zoom, setZoom] = useState(1);
  const [autoPlacing, setAutoPlacing] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldsRef = useRef<OverlayField[]>([]);
  const fieldHistoryPastRef = useRef<OverlayField[][]>([]);
  const fieldHistoryFutureRef = useRef<OverlayField[][]>([]);

  const selectedField = selectedIds.length === 1
    ? fields.find((field) => field.id === selectedIds[0]) ?? null
    : null;
  const sortedTemplates = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  );
  const canUndo = historyState.canUndo;
  const canRedo = historyState.canRedo;

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  function syncHistoryState() {
    setHistoryState({
      canUndo: fieldHistoryPastRef.current.length > 0,
      canRedo: fieldHistoryFutureRef.current.length > 0,
    });
  }

  function resetFieldHistory() {
    fieldHistoryPastRef.current = [];
    fieldHistoryFutureRef.current = [];
    syncHistoryState();
  }

  function recordFieldHistory() {
    const snapshot = cloneOverlayFields(fieldsRef.current);
    const latest = fieldHistoryPastRef.current.at(-1);
    if (latest && JSON.stringify(latest) === JSON.stringify(snapshot)) return;
    fieldHistoryPastRef.current = [...fieldHistoryPastRef.current.slice(-79), snapshot];
    fieldHistoryFutureRef.current = [];
    syncHistoryState();
  }

  function undoFields() {
    const previous = fieldHistoryPastRef.current.pop();
    if (!previous) return;
    fieldHistoryFutureRef.current = [
      cloneOverlayFields(fieldsRef.current),
      ...fieldHistoryFutureRef.current.slice(0, 79),
    ];
    setFields(cloneOverlayFields(previous));
    setSelectedIds([]);
    setSelectedTargets([]);
    syncHistoryState();
  }

  function redoFields() {
    const next = fieldHistoryFutureRef.current.shift();
    if (!next) return;
    fieldHistoryPastRef.current = [
      ...fieldHistoryPastRef.current.slice(-79),
      cloneOverlayFields(fieldsRef.current),
    ];
    setFields(cloneOverlayFields(next));
    setSelectedIds([]);
    setSelectedTargets([]);
    syncHistoryState();
  }

  function openEditor(template?: Template) {
    setEditing(template ?? null);
    setCurrentTemplateId(template?._id);
    setSaveState(template ? "saved" : "idle");
    setName(template?.name ?? "");
    setTemplateKind(template?.templateKind ?? "standard_glass");
    setFileId(template?.fileId ?? "");
    setFileName(template?.fileName ?? "");
    setOutputFileName(template?.outputFileName ?? "");
    setFileUrl(template?.fileUrl ?? null);
    setCertifiedNotice(template?.certifiedNotice ?? "");
    setFields(template?.fieldMappings?.fields ?? []);
    setStatus(template?.status ?? "active");
    setBuilderOpen(false);
    setSelectedIds([]);
    setSelectedTargets([]);
    setZoom(1);
    resetFieldHistory();
    setDrawerOpen(true);
  }

  async function uploadTemplate(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Certificate templates must be PDFs");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const result = (await response.json()) as { storageId: string };
      setFileId(result.storageId);
      setFileName(file.name);
      setFileUrl(URL.createObjectURL(file));
      toast.success("Template uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload template");
    } finally {
      setUploading(false);
    }
  }

  function openBuilder() {
    if (typeof window !== "undefined" && window.innerWidth < MIN_BUILDER_WIDTH) {
      toast.info("The PDF field editor works best on a larger screen or on your computer.");
      setBuilderOpen(false);
      return;
    }
    setBuilderOpen(true);
  }

  function addField(key: string, label: string) {
    recordFieldHistory();
    const field = newField(key, label);
    setFields((current) => [...current, field]);
    setSelectedIds([field.id]);
    setSelectedTargets([]);
  }

  function addCoverageTable() {
    recordFieldHistory();
    const field = newCoverageTable();
    setFields((current) => [...current, field]);
    setSelectedIds([field.id]);
    setSelectedTargets([]);
  }

  function dropField(payload: FieldDropPayload) {
    recordFieldHistory();
    const field =
      payload.kind === "coverage_table"
        ? {
            ...newCoverageTable(),
            x: Math.min(payload.x, 0.82),
            y: Math.min(payload.y, 0.78),
          }
        : {
            ...newField(payload.key, payload.label),
            x: Math.min(payload.x, 0.88),
            y: Math.min(payload.y, 0.94),
          };
    setFields((current) => [...current, field]);
    setSelectedIds([field.id]);
    setSelectedTargets([]);
  }

  function buildAutoPlaceTargets(): AutoPlaceTarget[] {
    const targets: AutoPlaceTarget[] = fields.map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
    }));
    const existingKeys = new Set(fields.map((field) => field.key).filter(Boolean));
    for (const target of AUTO_PLACE_TARGETS) {
      if (target.key && existingKeys.has(target.key)) continue;
      targets.push({ ...target, id: `new:${target.key}` });
    }
    return targets;
  }

  function createFieldFromPlacement(placement: AutoPlacePlacement): OverlayField {
    const field =
      placement.type === "coverage_table"
        ? newCoverageTable()
        : newField(placement.key ?? "custom_smart", placement.label);
    return {
      ...field,
      key: placement.key ?? field.key,
      label: placement.label || field.label,
      type: placement.type ?? field.type,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
  }

  function updateSelected(patch: Partial<OverlayField>) {
    if (selectedIds.length === 0) return;
    recordFieldHistory();
    const selected = new Set(selectedIds);
    setFields((current) =>
      current.map((field) => (selected.has(field.id) ? { ...field, ...patch } : field)),
    );
  }

  function updateCoverageConfig(patch: Partial<CoverageTableConfig>) {
    if (selectedIds.length !== 1) return;
    recordFieldHistory();
    const selectedId = selectedIds[0];
    setFields((current) =>
      current.map((field) =>
        field.id === selectedId
          ? {
              ...field,
              coverageConfig: {
                coverageMode: "all",
                columns: DEFAULT_COVERAGE_COLUMNS,
                ...(field.coverageConfig ?? {}),
                ...patch,
              },
            }
          : field,
      ),
    );
  }

  function removeSelected() {
    if (selectedIds.length === 0) return;
    recordFieldHistory();
    const selected = new Set(selectedIds);
    setFields((current) => current.filter((field) => !selected.has(field.id)));
    setSelectedIds([]);
    setSelectedTargets([]);
  }

  function selectField(fieldId: string, target: HTMLDivElement, additive: boolean) {
    if (!additive) {
      setSelectedIds([fieldId]);
      setSelectedTargets([target]);
      return;
    }
    setSelectedIds((current) =>
      current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId],
    );
    setSelectedTargets((current) =>
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target],
    );
  }

  function selectFields(nextFields: Array<{ id: string; target: HTMLDivElement }>) {
    setSelectedIds(nextFields.map((field) => field.id));
    setSelectedTargets(nextFields.map((field) => field.target));
  }

  function clearSelection() {
    setSelectedIds([]);
    setSelectedTargets([]);
  }

  function alignSelected(align: OverlayField["align"]) {
    if (selectedIds.length === 0) return;
    recordFieldHistory();
    const selected = new Set(selectedIds);
    setFields((current) =>
      current.map((field) => (selected.has(field.id) ? { ...field, align } : field)),
    );
  }

  function alignSelectedFields(align: OverlayField["align"]) {
    if (selectedIds.length < 2) return;
    recordFieldHistory();
    const selected = new Set(selectedIds);
    setFields((current) => {
      const selectedFields = current.filter((field) => selected.has(field.id));
      if (selectedFields.length < 2) return current;

      const left = Math.min(...selectedFields.map((field) => field.x));
      const right = Math.max(...selectedFields.map((field) => field.x + field.width));
      const center = left + (right - left) / 2;

      return current.map((field) => {
        if (!selected.has(field.id)) return field;
        const nextX =
          align === "left"
            ? left
            : align === "right"
              ? right - field.width
              : center - field.width / 2;
        return {
          ...field,
          x: Math.min(Math.max(nextX, 0), Math.max(1 - field.width, 0)),
        };
      });
    });
  }

  function moveSelected(updates: Array<{ id: string; x: number; y: number }>) {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((update) => [update.id, update]));
    setFields((current) =>
      current.map((field) => {
        const update = byId.get(field.id);
        return update ? { ...field, x: update.x, y: update.y } : field;
      }),
    );
  }

  function resizeSelected(updates: OverlayFieldResizeUpdate[]) {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((update) => [update.id, update.patch]));
    setFields((current) =>
      current.map((field) => {
        const patch = byId.get(field.id);
        return patch ? { ...field, ...patch } : field;
      }),
    );
  }

  async function autoPlaceFields() {
    if (!fileId || !fileUrl) {
      toast.error("Upload a PDF template before auto-placing fields");
      return;
    }
    setAutoPlacing(true);
    try {
      const targets = buildAutoPlaceTargets();
      const candidates = await extractAutoPlaceCandidates(fileUrl);
      if (candidates.length === 0) {
        throw new Error("Could not read template layout from this PDF");
      }
      const result = await autoPlaceTemplateFields({
        fileId: fileId as Id<"_storage">,
        fields: targets.map((target) => ({
          id: target.id,
          key: target.key,
          label: target.label,
          type: target.type,
        })),
        candidates,
      }) as { matches?: AutoPlaceMatch[] };
      const matches = result.matches ?? [];
      const targetById = new Map(targets.map((target) => [target.id, target]));
      const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const placements = matches
        .map((match) => {
          const candidate = candidateById.get(match.candidateId);
          const target = targetById.get(match.fieldId);
          if (!candidate || !target) return null;
          return {
            ...target,
            x: candidate.x,
            y: candidate.y,
            width: candidate.width,
            height: candidate.height,
          } satisfies AutoPlacePlacement;
        })
        .filter(Boolean) as AutoPlacePlacement[];

      recordFieldHistory();
      setFields((current) => {
        const currentById = new Map(current.map((field) => [field.id, field]));
        const updatesById = new Map(
          placements
            .filter((placement) => currentById.has(placement.id))
            .map((placement) => [placement.id, placement]),
        );
        const updated = current.map((field) => {
          const placement = updatesById.get(field.id);
          return placement
            ? {
                ...field,
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
              }
            : field;
        });
        const additions = placements
          .filter((placement) => placement.id.startsWith("new:") && targetById.has(placement.id))
          .map((placement) => createFieldFromPlacement({
            ...placement,
            ...targetById.get(placement.id),
          } as AutoPlacePlacement));
        return [...updated, ...additions];
      });
      clearSelection();
      toast.success("Auto-placed fields from PDF geometry");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not auto-place fields");
    } finally {
      setAutoPlacing(false);
    }
  }

  const persistTemplate = useCallback(async () => {
    if (!drawerOpen || !name.trim()) {
      return;
    }
    setSaving(true);
    try {
      const savedId = await saveTemplate({
        templateId: currentTemplateId,
        name: name.trim(),
        templateKind,
        fileId: fileId ? (fileId as Id<"_storage">) : undefined,
        fileName: fileName || undefined,
        outputFileName: outputFileName.trim() || undefined,
        certifiedNotice: certifiedNotice || undefined,
        fieldMappings: templateKind === "pdf_overlay" ? { fields } : undefined,
        fallbackToStandard: true,
        status,
      });
      setCurrentTemplateId(savedId as Id<"coiTemplates">);
      await upsertTemplates({}, (current) => {
        const existing = current ?? [];
        const nextTemplate: Template = {
          ...(editing ?? {}),
          _id: savedId as Id<"coiTemplates">,
          name: name.trim(),
          templateKind,
          fileId: fileId ? (fileId as Id<"_storage">) : undefined,
          fileName: fileName || undefined,
          outputFileName: outputFileName.trim() || undefined,
          fileUrl,
          certifiedNotice: certifiedNotice || undefined,
          fieldMappings: templateKind === "pdf_overlay" ? { fields } : undefined,
          fallbackToStandard: true,
          status,
        };
        return [
          nextTemplate,
          ...existing.filter((template) => template._id !== nextTemplate._id),
        ].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "Could not save template");
    } finally {
      setSaving(false);
    }
  }, [
    certifiedNotice,
    currentTemplateId,
    drawerOpen,
    fields,
    fileId,
    fileName,
    name,
    outputFileName,
    saveTemplate,
    status,
    templateKind,
    upsertTemplates,
    editing,
    fileUrl,
  ]);

  useEffect(() => {
    if (!drawerOpen || !name.trim()) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void persistTemplate();
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [drawerOpen, name, templateKind, fileId, fileName, outputFileName, certifiedNotice, fields, status, persistTemplate]);

  useEffect(() => {
    if (!builderOpen) return;
    const handleResize = () => {
      if (window.innerWidth >= MIN_BUILDER_WIDTH) return;
      setBuilderOpen(false);
      toast.info("The PDF field editor works best on a larger screen or on your computer.");
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [builderOpen]);

  async function closeEditor() {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (name.trim()) {
      await persistTemplate();
    }
    setDrawerOpen(false);
  }

  return (
    <>
    <AppShell
      breadcrumbDetail="Templates"
      actions={
        <PillButton size="compact" variant="secondary" onClick={() => openEditor()}>
          <Plus className="size-3.5" />
          New template
        </PillButton>
      }
      rightPanel={
        <SettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={editing ? "Edit template" : "New template"}
          footer={
            <>
              <div className="flex min-h-7 flex-1 items-center text-label text-muted-foreground/70">
                {saving || uploading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" />
                    Saving...
                  </span>
                ) : saveState === "saved" ? (
                  "Saved"
                ) : saveState === "error" ? (
                  "Save failed"
                ) : name.trim() ? (
                  "Autosaves changes"
                ) : (
                  "Name the template to start autosaving"
                )}
              </div>
              <PillButton disabled={saving || uploading} onClick={() => void closeEditor()}>
                Done
              </PillButton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Template name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Generated PDF file name
              <Input
                value={outputFileName}
                onChange={(event) => setOutputFileName(event.target.value)}
                placeholder="COI - {{holder}} - {{policy_number}}.pdf"
              />
              <span className="text-label font-normal leading-5 text-muted-foreground/60">
                Optional. Supports {"{{holder}}"}, {"{{policy_number}}"}, {"{{carrier}}"}, {"{{insured}}"} and {"{{date}}"}.
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium text-muted-foreground">Generation process</p>
              <Select value={templateKind} onValueChange={(value) => setTemplateKind(value as TemplateKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{TEMPLATE_KIND_LABELS[templateKind]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard_glass">Standard Glass certificate</SelectItem>
                  <SelectItem value="pdf_overlay">Existing PDF template with fields</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {templateKind !== "pdf_overlay" ? (
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Certified notice
                <Textarea value={certifiedNotice} onChange={(event) => setCertifiedNotice(event.target.value)} rows={3} />
                <span className="text-label font-normal leading-5 text-muted-foreground/60">
                  Optional language printed on certified COIs, usually the MGA approval or certification statement.
                  Example: “Approved and certified by ReLease for the named program.”
                </span>
              </label>
            ) : null}

            {templateKind === "pdf_overlay" ? (
              <>
                <FileDropZone
                  onFile={uploadTemplate}
                  disabled={uploading}
                  idleLabel={fileName || "Upload PDF certificate template"}
                  busyLabel="Uploading template..."
                  hint="PDF overlay templates fall back to standard Glass generation if rendering fails."
                />
                {fileUrl ? (
                  <OperationalPanel as="div" className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-foreground">{fileName}</p>
                        <p className="text-label text-muted-foreground/60">
                          {fields.length} fields placed
                        </p>
                      </div>
                      <PillButton
                        type="button"
                        size="compact"
                        variant="secondary"
                        onClick={openBuilder}
                      >
                        <Maximize2 className="size-3.5" />
                        Configure fields
                      </PillButton>
                    </div>
                  </OperationalPanel>
                ) : null}
              </>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium text-muted-foreground">Status</p>
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
        {templates === undefined ? (
          <OperationalSkeletonList rows={4} showTrailing={false} />
        ) : templates.length === 0 ? (
          <EmptyStateCard
            icon={<FileText className="size-5" />}
            title="No certificate templates yet"
            description="Use the standard Glass certificate process or upload an existing PDF and place fields on top."
            actionLabel="New template"
            onAction={() => openEditor()}
          />
        ) : (
          <OperationalPanel>
            {sortedTemplates.map((template) => (
              <OperationalItem
                key={template._id}
                className="border-foreground/4 p-0"
              >
                <button
                  type="button"
                  onClick={() => openEditor(template)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-base font-medium text-foreground">{template.name}</p>
                      <Badge variant="secondary" className="font-normal text-muted-foreground">
                        {template.templateKind === "pdf_overlay"
                          ? "PDF overlay"
                          : "Standard Glass"}
                      </Badge>
                      <Badge variant={template.status === "active" ? "secondary" : "outline"} className="font-normal text-muted-foreground">
                        {template.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-base text-muted-foreground">
                      {[
                        template.outputFileName
                          ? `Outputs ${template.outputFileName}`
                          : template.fileName,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </button>
              </OperationalItem>
            ))}
          </OperationalPanel>
        )}
      </div>
    </AppShell>
    <PdfTemplateBuilderPanel
      open={builderOpen}
      fileUrl={fileUrl}
      fileId={fileId}
      fileName={fileName}
      fields={fields}
      selectedField={selectedField}
      selectedIds={selectedIds}
      pageElement={pageElement}
      selectedTargets={selectedTargets}
      zoom={zoom}
      autoPlacing={autoPlacing}
      onOpenChange={setBuilderOpen}
      onAddField={addField}
      onAddCoverageTable={addCoverageTable}
      onDropField={dropField}
      onAutoPlace={autoPlaceFields}
      onUpdateSelected={updateSelected}
      onUpdateCoverageConfig={updateCoverageConfig}
      onRemoveSelected={removeSelected}
      onRecordHistory={recordFieldHistory}
      onUndo={undoFields}
      onRedo={redoFields}
      canUndo={canUndo}
      canRedo={canRedo}
      onSelectField={selectField}
      onSelectFields={selectFields}
      onClearSelection={clearSelection}
      onAlignSelected={alignSelected}
      onAlignSelectedFields={alignSelectedFields}
      onMoveSelected={moveSelected}
      onResizeSelected={resizeSelected}
      onPageElementChange={setPageElement}
      onZoomChange={setZoom}
    />
    </>
  );
}
