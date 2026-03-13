"use client";

import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { StatCard } from "@/components/stats-cards";
import { ApplicationsList } from "@/components/applications-list";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Play, CheckCircle, FileInput } from "lucide-react";

export default function ApplicationsPage() {
  const stats = useQuery(api.applicationSessions.stats);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Applications</h1>
              <p className="text-body-sm text-muted-foreground">
                Insurance application forms processed by Clarity Agent
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
            <StatCard
              label="Active"
              value={stats?.active ?? "—"}
              icon={Play}
              staggerIndex={1}
            />
            <StatCard
              label="Completed"
              value={stats?.completed ?? "—"}
              icon={CheckCircle}
              staggerIndex={2}
            />
            <StatCard
              label="Total"
              value={stats?.total ?? "—"}
              icon={FileInput}
              staggerIndex={3}
            />
          </div>

          <FadeIn when={true} staggerIndex={4} duration={0.6}>
            <ApplicationsList />
          </FadeIn>
        </div>
      </main>
    </div>
  );
}
