"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import type { Doc } from "@/convex/_generated/dataModel";

type Props = {
  onSelect: (template: Doc<"applicationTemplates">) => void;
};

export function TemplatePicker({ onSelect }: Props) {
  const [lob, setLob] = useState<string | undefined>();
  const templates = useQuery((api as any).applicationTemplates.list, {
    lineOfBusiness: lob,
  }) as Doc<"applicationTemplates">[] | undefined;

  const lobs = [
    ...new Set((templates ?? []).map((t) => t.lineOfBusiness).filter(Boolean)),
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={lob === undefined ? "default" : "outline"}
          size="sm"
          onClick={() => setLob(undefined)}
        >
          All
        </Button>
        {lobs.map((l) => (
          <Button
            key={l}
            variant={lob === l ? "default" : "outline"}
            size="sm"
            onClick={() => setLob(l ?? undefined)}
          >
            {l}
          </Button>
        ))}
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {(templates ?? []).map((t) => (
          <button
            key={t._id}
            className="w-full text-left p-3 rounded-lg border border-foreground/10 bg-card hover:bg-accent transition-colors"
            onClick={() => onSelect(t)}
          >
            <div className="font-medium text-sm">{t.name}</div>
            {t.description && (
              <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
            )}
            {t.lineOfBusiness && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {t.lineOfBusiness}
              </div>
            )}
          </button>
        ))}
        {(templates ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground px-2 py-4 text-center">
            No templates available.
          </p>
        )}
      </div>
    </div>
  );
}
