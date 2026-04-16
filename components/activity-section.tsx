"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/ui/fade-in";

interface ActivitySectionProps {
  /** Section title in the collapsible header */
  title: string;
  /** Count shown next to the title (e.g. number of entries) */
  count?: number;
  /** True while data is still loading */
  loading?: boolean;
  /** Number of skeleton rows to show while loading (default 3) */
  skeletonRows?: number;
  /** Empty state icon */
  emptyIcon?: React.ComponentType<{ className?: string }>;
  /** Empty state primary text */
  emptyMessage?: string;
  /** Empty state secondary text */
  emptyDescription?: string;
  /** Whether the section has items (controls empty state rendering) */
  isEmpty?: boolean;
  /** Footer text (e.g. "5 runs") — shown at the bottom of the section */
  footerText?: string;
  /** Section content */
  children: React.ReactNode;
  /** Start collapsed (default false) */
  defaultCollapsed?: boolean;
}

export function ActivitySection({
  title,
  count,
  loading,
  skeletonRows = 3,
  emptyIcon: EmptyIcon,
  emptyMessage,
  emptyDescription,
  isEmpty,
  footerText,
  children,
  defaultCollapsed = false,
}: ActivitySectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Loading state — show skeleton rows inside the consistent card shell
  if (loading) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="px-5 py-2.5 bg-foreground/[0.015] border-b border-foreground/6">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
        <div className="divide-y divide-foreground/4">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <Skeleton className="w-4 h-4 rounded-full shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <div className="flex gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (isEmpty) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          {EmptyIcon && (
            <EmptyIcon className="w-5 h-5 text-muted-foreground/20 mx-auto mb-2" />
          )}
          {emptyMessage && (
            <p className="text-body-sm text-muted-foreground/60">
              {emptyMessage}
            </p>
          )}
          {emptyDescription && (
            <p className="text-label-sm text-muted-foreground/40 mt-0.5">
              {emptyDescription}
            </p>
          )}
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        {/* Collapsible section header */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full px-5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-foreground/[0.03] transition-colors bg-foreground/[0.015] ${collapsed ? "" : "border-b border-foreground/6"}`}
        >
          <p className="text-label-sm font-medium text-muted-foreground">
            {title}
            {count != null && (
              <span className="ml-1.5 opacity-50">{count}</span>
            )}
          </p>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>

        {!collapsed && (
          <>
            {children}
            {footerText && (
              <div className="border-t border-foreground/[0.04] px-4 py-2 bg-foreground/[0.01]">
                <p className="text-label-sm text-muted-foreground/60">
                  {footerText}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </FadeIn>
  );
}
