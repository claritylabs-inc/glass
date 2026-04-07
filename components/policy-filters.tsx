"use client";

import { motion } from "framer-motion";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FilterDropdown } from "@/components/ui/filter-dropdown";

type DocumentView = "active" | "expired" | "quotes";

interface PolicyFiltersProps {
  documentView: DocumentView;
  onDocumentViewChange: (view: DocumentView) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  carriers: string[];
  years: number[];
  selectedType: string;
  onTypeChange: (type: string) => void;
  selectedCarrier: string;
  onCarrierChange: (carrier: string) => void;
  selectedYear: string;
  onYearChange: (year: string) => void;
}

const VIEWS: { id: DocumentView; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
  { id: "quotes", label: "Quotes" },
];

const TABS = [
  { id: "all", label: "All" },
  { id: "type", label: "By Type" },
  { id: "year", label: "By Year" },
];

export function PolicyFilters({
  documentView,
  onDocumentViewChange,
  activeTab,
  onTabChange,
  carriers,
  years,
  selectedType,
  onTypeChange,
  selectedCarrier,
  onCarrierChange,
  selectedYear,
  onYearChange,
}: PolicyFiltersProps) {
  return (
    <div className="space-y-3 mb-4">
      {/* View segment control */}
      <div className="inline-flex items-center rounded-lg border border-foreground/8 bg-foreground/[0.02] p-0.5">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => onDocumentViewChange(view.id)}
            className={`relative px-3 py-1 rounded-md text-label-sm font-medium transition-all cursor-pointer ${
              documentView === view.id
                ? "text-foreground bg-white dark:bg-white/10 shadow-sm"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-foreground/6 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === "all" && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="All Types"
            value={selectedType}
            onChange={onTypeChange}
            options={Object.entries(POLICY_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />

          <FilterDropdown
            label="All Producers"
            value={selectedCarrier}
            onChange={onCarrierChange}
            options={carriers.map((c) => ({ value: c, label: c }))}
          />

          <FilterDropdown
            label="All Years"
            value={selectedYear}
            onChange={onYearChange}
            options={years
              .sort((a, b) => b - a)
              .map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
      )}
    </div>
  );
}
