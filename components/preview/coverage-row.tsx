"use client";

/** Single coverage line inside a bordered card with dividers */
export function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-body-sm min-w-0">
      <span className="text-foreground truncate min-w-0">{name}</span>
      <div className="flex items-baseline gap-2 shrink-0">
        {limit && <span className="text-muted-foreground whitespace-nowrap">{limit}</span>}
        {deductible && (
          <span className="text-muted-foreground/50 whitespace-nowrap">ded {deductible}</span>
        )}
      </div>
    </div>
  );
}
