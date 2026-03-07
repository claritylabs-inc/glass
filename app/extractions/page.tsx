"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion } from "framer-motion";
import { Nav } from "@/components/nav";
import { ExtractionTable } from "@/components/extraction-table";
import { ExtractionLog } from "@/components/extraction-log";
import { FadeIn } from "@/components/ui/fade-in";

const TABS = [
  { id: "pending", label: "Pending" },
  { id: "completed", label: "Completed" },
];

export default function ExtractionsPage() {
  const pending = useQuery(api.policies.listPending, {});
  const log = useQuery(api.policies.listExtractionLog, {});
  const [activeTab, setActiveTab] = useState("pending");

  const pendingCount = pending?.length ?? 0;
  const completedCount = log?.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Extractions</h1>
              <p className="text-body-sm text-muted-foreground">
                Documents being processed from email attachments
              </p>
            </div>
          </FadeIn>

          <div className="mb-4">
            <div className="flex items-center gap-1 border-b border-foreground/6 overflow-x-auto scrollbar-hide">
              {TABS.map((tab) => {
                const count = tab.id === "pending" ? pendingCount : completedCount;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/70"
                    }`}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span className={`ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-label-sm font-medium ${
                        tab.id === "pending" && count > 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-foreground/5 text-muted-foreground"
                      }`}>
                        {count}
                      </span>
                    )}
                    {activeTab === tab.id && (
                      <motion.div
                        layoutId="extraction-tab-indicator"
                        className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === "pending" && (
            <ExtractionTable extractions={pending} />
          )}

          {activeTab === "completed" && (
            <ExtractionLog entries={log ?? []} />
          )}
        </div>
      </main>
    </div>
  );
}
