"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, Mail, Clock, FileSearch } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

interface StatsData {
  totalPolicies: number;
  activeConnections: number;
  lastScanAt: number | null;
  pendingExtractions: number;
  byType: Record<string, number>;
}

export function StatsCards({ stats }: { stats: StatsData | undefined }) {
  const items = [
    {
      label: "Total Policies",
      value: stats?.totalPolicies ?? "—",
      icon: FileText,
      href: "/policies",
    },
    {
      label: "Connections",
      value: stats?.activeConnections ?? "—",
      icon: Mail,
      href: "/connections",
    },
    {
      label: "Last Scan",
      value: stats?.lastScanAt ? formatTimeAgo(stats.lastScanAt) : "Never",
      icon: Clock,
      href: "/connections",
    },
    {
      label: "Extractions",
      value: stats?.pendingExtractions ?? "—",
      icon: FileSearch,
      href: "/extractions",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-6">
      {items.map((stat, i) => (
        <FadeIn key={stat.label} staggerIndex={i} when={true} duration={0.6}>
          <Link href={stat.href} className="block">
            <motion.div
              whileHover={{
                scale: 1.02,
                boxShadow:
                  "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -4px rgb(0 0 0 / 0.08)",
                borderColor: "rgba(0,0,0,0.2)",
                backgroundColor: "white",
              }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
              className="group rounded-lg border border-foreground/6 bg-white/60 px-3 py-2.5 sm:px-4 sm:py-3 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
                    {stat.label}
                  </p>
                  <p className="text-lg sm:text-xl font-semibold text-foreground-highlight mt-1 font-mono">
                    {stat.value}
                  </p>
                </div>
                <span className="mt-1 shrink-0 rounded-full bg-foreground/4 p-1.5 text-foreground/35 transition-colors group-hover:bg-foreground/8 group-hover:text-foreground/55">
                  <stat.icon className="w-3.5 h-3.5" />
                </span>
              </div>
            </motion.div>
          </Link>
        </FadeIn>
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
