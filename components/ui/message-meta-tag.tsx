"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MessageMetaTag({
  icon,
  label,
  count,
  showSingleCount = false,
  isActive = false,
  onClick,
  className,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  showSingleCount?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const showCount =
    typeof count === "number" && (count > 1 || (showSingleCount && count > 0));
  const title = isActive ? undefined : label;
  const classNames = cn(
    "inline-flex h-6 items-center justify-center rounded-full border px-[7px] text-tag font-medium leading-none transition-[border-color,background-color,color,transform] duration-150 ease-out",
    onClick ? "cursor-pointer active:scale-[0.97]" : "",
    isActive
      ? "border-foreground/18 bg-foreground/[0.04] text-foreground/75"
      : "border-foreground/8 bg-transparent text-muted-foreground/55 hover:border-foreground/12 hover:bg-foreground/[0.03] hover:text-foreground/75",
    className,
  );
  const content = (
    <>
      <span className="flex shrink-0 items-center justify-center leading-none [&>svg]:h-3 [&>svg]:w-3">
        {icon}
      </span>
      {showCount ? (
        <span className="pl-1 tabular-nums text-muted-foreground/35">
          {count}
        </span>
      ) : null}
      <span
        className={cn(
          "grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
          isActive
            ? "grid-cols-[1fr] opacity-100"
            : "grid-cols-[0fr] opacity-0",
        )}
        aria-hidden={!isActive}
      >
        <span className="min-w-0 overflow-hidden">
          <span className="whitespace-nowrap pl-1.5">{label}</span>
        </span>
      </span>
    </>
  );

  if (!onClick) {
    return (
      <span
        aria-label={showCount ? `${label} (${count})` : label}
        className={classNames}
        title={title}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isActive}
      aria-label={showCount ? `${label} (${count})` : label}
      className={classNames}
      title={title}
    >
      {content}
    </button>
  );
}
