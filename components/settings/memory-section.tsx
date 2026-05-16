"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Brain, MessageSquare, Mail, FileText, Sparkles } from "lucide-react";

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
  const memories = useQuery(api.orgMemory.list);

  if (memories === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card px-5 py-10 text-center text-body-sm text-muted-foreground/60">
        Loading memory…
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-body-sm font-medium text-foreground mb-1">Memory</h3>
          <p className="text-body-sm text-muted-foreground">
            Facts Glass has learned about your organization from chats, emails,
            and website enrichment.
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-card px-5 py-10 text-center">
          <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground">No memory yet</p>
          <p className="text-label-sm text-muted-foreground/50 mt-0.5">
            Glass will capture durable facts as you chat and forward emails.
          </p>
        </div>
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
        <h3 className="text-body-sm font-medium text-foreground mb-1">Memory</h3>
        <p className="text-body-sm text-muted-foreground">
          Facts Glass has learned about your organization from chats, emails,
          and website enrichment.
        </p>
      </div>

      <div className="space-y-3">
        {order
          .filter((t) => grouped[t]?.length)
          .map((type) => (
            <div
              key={type}
              className="rounded-lg border border-foreground/6 bg-card overflow-hidden"
            >
              <div className="px-5 py-3.5 border-b border-foreground/6 flex items-center justify-between">
                <h4 className="mb-0! text-sm font-medium text-foreground">
                  {TYPE_LABELS[type] ?? type}
                </h4>
                <span className="text-label-sm text-muted-foreground/50">
                  {grouped[type].length}
                </span>
              </div>
              <div className="divide-y divide-foreground/6">
                {grouped[type].map((m) => {
                  const Icon = SOURCE_ICONS[m.source] ?? Brain;
                  return (
                    <div
                      key={m._id}
                      className="px-5 py-3 flex items-start gap-3"
                    >
                      <Icon className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-body-sm text-foreground leading-snug">
                          {m.content}
                        </p>
                        <p className="text-label-sm text-muted-foreground/50 mt-1">
                          {SOURCE_LABELS[m.source] ?? m.source}
                          {" · "}
                          {new Date(m.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
