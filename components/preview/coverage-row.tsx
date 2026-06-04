"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function cleanDeductible(deductible?: string) {
  return deductible?.trim().replace(/^ded(?:uctible)?\s+/i, "");
}

/** Single coverage item inside the policy preview. */
export function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  const deductibleText = cleanDeductible(deductible);
  const hasHiddenCondition = !!deductibleText;

  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 px-3 py-2.5 text-base">
      <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
      <div className="flex min-w-0 max-w-[48%] shrink-0 items-baseline justify-end gap-1.5 text-right">
        {limit && <span className="truncate tabular-nums text-muted-foreground">{limit}</span>}
        {hasHiddenCondition && (
          <Tooltip>
            <TooltipTrigger
              className="shrink-0 cursor-help text-muted-foreground/45 hover:text-muted-foreground/70"
              aria-label="Show additional condition or deductible"
            >
              *
            </TooltipTrigger>
            <TooltipContent
              className="max-w-80 whitespace-normal text-left leading-5 **:[[class*='size-2.5']]:hidden"
              side="top"
              align="end"
            >
              {deductibleText}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
