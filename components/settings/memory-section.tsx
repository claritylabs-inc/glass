"use client";

import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { Brain, MessageSquare, Mail, FileText, Sparkles } from "lucide-react";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

const TYPE_LABELS: Record<string, string> = {
  fact: "Facts",
  preference: "Preferences",
  risk_note: "Risk notes",
  observation: "Observations",
};

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  email: Mail,
  extraction: FileText,
  analysis: Sparkles,
};

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat",
  email: "Email",
  extraction: "Extraction",
  analysis: "Analysis",
};

export function MemorySection() {
  const memories = useCachedQuery("orgMemory.list", api.orgMemory.list, {});

  if (memories === undefined) {
    return (
      <OperationalPanel as="div" className="px-5 py-10 text-center text-base text-muted-foreground/60">
        Loading memory…
      </OperationalPanel>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground mb-1">Memory</h3>
          <p className="text-base text-muted-foreground">
            Facts Glass has learned about your organization from chats, emails,
            and website enrichment.
          </p>
        </div>
        <OperationalPanel as="div" className="px-5 py-10 text-center">
          <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-base text-muted-foreground">No memory yet</p>
          <p className="text-label text-muted-foreground/50 mt-0.5">
            Glass will capture durable facts as you chat and forward emails.
          </p>
        </OperationalPanel>
      </div>
    );
  }

  const grouped = memories.reduce<Record<string, typeof memories>>((acc, m) => {
    const key = m.type ?? "observation";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const order = ["fact", "preference", "risk_note", "observation"];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium text-foreground mb-1">Memory</h3>
        <p className="text-base text-muted-foreground">
          Facts Glass has learned about your organization from chats, emails,
          and website enrichment.
        </p>
      </div>

      <div className="space-y-3">
        {order
          .filter((t) => grouped[t]?.length)
          .map((type) => (
            <OperationalPanel key={type}>
              <OperationalPanelHeader
                title={TYPE_LABELS[type] ?? type}
                action={
                  <span className="text-label text-muted-foreground/50">
                    {grouped[type].length}
                  </span>
                }
                className="px-5 py-3.5"
              />
              <div className="divide-y divide-foreground/6">
                {grouped[type].map((m) => {
                  const Icon = SOURCE_ICONS[m.source] ?? Brain;
                  return (
                    <OperationalItem
                      key={m._id}
                      className="flex items-start gap-3 px-5 py-3"
                    >
                      <Icon className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-base text-foreground leading-snug">
                          {m.content}
                        </p>
                        <p className="text-label text-muted-foreground/50 mt-1">
                          {SOURCE_LABELS[m.source] ?? m.source}
                          {" · "}
                          {dayjs(m.updatedAt).format("M/D/YYYY")}
                        </p>
                      </div>
                    </OperationalItem>
                  );
                })}
              </div>
            </OperationalPanel>
          ))}
      </div>
    </div>
  );
}
