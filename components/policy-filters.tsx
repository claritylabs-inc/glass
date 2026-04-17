"use client";

interface PolicyFiltersProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "type", label: "By Type" },
  { id: "year", label: "By Year" },
];

export function PolicyFilters({
  activeTab,
  onTabChange,
}: PolicyFiltersProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-1 text-label-sm rounded-full whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "bg-foreground/8 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
