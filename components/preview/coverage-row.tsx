"use client";

/** Single coverage line with limit and deductible */
export function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 px-2 rounded bg-foreground/[0.02] text-label">
      <span className="text-foreground truncate mr-2">{name}</span>
      <div className="flex items-baseline gap-2 shrink-0">
        {limit && <span className="text-muted-foreground/60 font-mono text-label-sm">{limit}</span>}
        {deductible && (
          <span className="text-muted-foreground/35 font-mono text-label-sm">ded {deductible}</span>
        )}
      </div>
    </div>
  );
}
