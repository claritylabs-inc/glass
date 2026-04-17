"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { FadeIn } from "@/components/ui/fade-in";

export function StatCard({
  label,
  value,
  href,
  staggerIndex = 0,
}: {
  label: string;
  value: string | number;
  href?: string;
  staggerIndex?: number;
}) {
  const card = (
    <motion.div
      whileHover={{
        scale: 1.02,
        borderColor: "var(--input)",
        backgroundColor: "var(--popover)",
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
      className="group rounded-lg border border-foreground/6 bg-card px-3 py-2.5 sm:px-4 sm:py-3 cursor-pointer"
    >
      <p className="text-label-sm font-medium text-muted-foreground ">
        {label}
      </p>
      <p className="text-lg sm:text-xl font-semibold text-foreground-highlight mt-1 font-mono">
        {value}
      </p>
    </motion.div>
  );

  return (
    <FadeIn staggerIndex={staggerIndex} when={true} duration={0.6}>
      {href ? <Link href={href} className="block">{card}</Link> : card}
    </FadeIn>
  );
}

interface StatsData {
  totalPolicies: number;
  activeConnections: number;
  lastScanAt: number | null;
  pendingExtractions: number;
  byType: Record<string, number>;
}

export function StatsCards({ stats }: { stats: StatsData | undefined }) {
  const totalDocs = stats?.totalPolicies ?? 0;
  const items = [
    {
      label: "Documents",
      value: stats !== undefined ? totalDocs : "—",
      href: "/policies",
    },
    {
      label: "Connections",
      value: stats?.activeConnections ?? "—",
      href: "/connections",
    },
    {
      label: "Last Scan",
      value: stats?.lastScanAt ? formatTimeAgo(stats.lastScanAt) : "Never",
      href: "/connections",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4 mb-6">
      {items.map((stat, i) => (
        <StatCard
          key={stat.label}
          label={stat.label}
          value={stat.value}

          href={stat.href}
          staggerIndex={i}
        />
      ))}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
