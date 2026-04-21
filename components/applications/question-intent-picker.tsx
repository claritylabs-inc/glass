"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Doc } from "@/convex/_generated/dataModel";

type Props = {
  onSelect: (intent: Doc<"questionIntents">) => void;
  onClose: () => void;
};

export function QuestionIntentPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const intents = useQuery((api as any).questionIntents.search, {
    query: query || undefined,
  }) as Doc<"questionIntents">[] | undefined;

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search questions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="max-h-60 overflow-y-auto space-y-1 border rounded-md p-1">
        {(intents ?? []).map((intent) => (
          <button
            key={intent._id}
            className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent"
            onClick={() => {
              onSelect(intent);
              onClose();
            }}
          >
            <div className="font-medium">{intent.label}</div>
            <div className="text-xs text-muted-foreground">
              {intent.category} · {intent.answerType}
            </div>
          </button>
        ))}
        {(intents ?? []).length === 0 && query && (
          <p className="text-xs text-muted-foreground px-2 py-1">
            No results — add a custom question below
          </p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} className="w-full">
        Cancel
      </Button>
    </div>
  );
}
