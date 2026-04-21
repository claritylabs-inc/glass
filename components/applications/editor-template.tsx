"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { TemplatePicker } from "./template-picker";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type Props = {
  applicationId: Id<"applications">;
  onSend: () => void;
};

export function EditorTemplate({ applicationId, onSend }: Props) {
  const [selected, setSelected] = useState<Doc<"applicationTemplates"> | null>(null);
  const [loading, setLoading] = useState(false);

  const cloneTemplate = useMutation((api as any).applications.cloneTemplateQuestions);
  const sendApp = useMutation((api as any).applications.send);

  async function handleSend() {
    if (!selected) return;
    setLoading(true);
    try {
      await cloneTemplate({ applicationId, templateId: selected._id });
      await sendApp({ applicationId });
      onSend();
    } finally {
      setLoading(false);
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-lg border border-foreground/10 bg-card">
          <div className="font-medium">{selected.name}</div>
          {selected.description && (
            <div className="text-sm text-muted-foreground mt-0.5">{selected.description}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {selected.questionSet.length} questions
            {selected.lineOfBusiness && ` · ${selected.lineOfBusiness}`}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(null)}
          >
            Change
          </Button>
          <Button
            className="flex-1"
            onClick={handleSend}
            disabled={loading}
          >
            {loading ? "Sending…" : "Send Application"}
          </Button>
        </div>
      </div>
    );
  }

  return <TemplatePicker onSelect={setSelected} />;
}
