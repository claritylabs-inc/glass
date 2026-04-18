"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { POLICY_TYPE_COLORS, PERSONAL_LINE_KEYS } from "@/convex/lib/policyTypes";

export function parseDollarAmount(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[$,\s]/g, "").trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KMBkmb])?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") return num * 1_000;
  if (suffix === "M") return num * 1_000_000;
  if (suffix === "B") return num * 1_000_000_000;
  return num;
}

export function formatCoverage(n: number): string {
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return `$${n.toLocaleString()}`;
}

export interface CoverageByType {
  typeKey: string;
  label: string;
  totalCoverage: number;
  policyCount: number;
}

function CoverageGrid({ rows }: { rows: CoverageByType[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      {rows.map((row) => (
        <Link key={row.typeKey} href="/policies">
          <motion.div
            whileHover={{
              scale: 1.02,
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -4px rgb(0 0 0 / 0.08)",
              borderColor: "var(--input)",
              backgroundColor: "var(--popover)",
            }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
            className="rounded-lg border border-foreground/6 bg-card p-3 cursor-pointer"
          >
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium mb-2 max-w-full truncate ${
                POLICY_TYPE_COLORS[row.typeKey] || POLICY_TYPE_COLORS.other
              }`}
            >
              {row.label}
            </span>
            <p className="text-lg font-semibold text-foreground font-mono">
              {formatCoverage(row.totalCoverage)}
            </p>
            <p className="text-label-sm text-muted-foreground/50">
              {row.policyCount} {row.policyCount === 1 ? "policy" : "policies"}
            </p>
          </motion.div>
        </Link>
      ))}
    </div>
  );
}

export function CoverageByTypeSection({ data }: { data: CoverageByType[] | undefined }) {
  // Loading state
  if (data === undefined) {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-foreground/6 bg-card p-3">
              <Skeleton className="h-5 w-20 rounded-full mb-2.5" />
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty — hide entirely
  if (data.length === 0) return null;

  const commercial = data.filter((r) => !PERSONAL_LINE_KEYS.has(r.typeKey));
  const personal = data.filter((r) => PERSONAL_LINE_KEYS.has(r.typeKey));

  return (
    <FadeIn when={true} staggerIndex={1} duration={0.6}>
      <div className="mb-6">
        <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:justify-between mb-3">
          <p className="text-body-sm font-semibold text-foreground">Coverage by Risk Type</p>
          <span className="text-label-sm text-muted-foreground/50">active policies</span>
        </div>

        {commercial.length > 0 && (
          <div className="mb-4">
            <p className="text-label-sm font-medium text-muted-foreground mb-2">Commercial</p>
            <CoverageGrid rows={commercial} />
          </div>
        )}

        {personal.length > 0 && (
          <div>
            <p className="text-label-sm font-medium text-muted-foreground mb-2">Personal</p>
            <CoverageGrid rows={personal} />
          </div>
        )}
      </div>
    </FadeIn>
  );
}
