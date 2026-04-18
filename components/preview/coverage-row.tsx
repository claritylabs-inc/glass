"use client";

/** Single coverage line with limit and deductible */
export function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 px-3 rounded-lg bg-secondary/50 text-body-sm">
      <span className="text-foreground truncate mr-3">{name}</span>
      <div className="flex items-baseline gap-2 shrink-0">
        {limit && <span className="text-muted-foreground">{limit}</span>}
        {deductible && (
          <span className="text-muted-foreground/50">ded {deductible}</span>
        )}
      </div>
    </div>
  );
}
