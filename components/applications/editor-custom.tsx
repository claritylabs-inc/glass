"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuestionIntentPicker } from "./question-intent-picker";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type Props = {
  applicationId: Id<"applications">;
  onSend: () => void;
};

type PendingQuestion = {
  key: string;
  intentKey?: string;
  prompt: string;
  answerType: string;
  required: boolean;
};

export function EditorCustom({ applicationId, onSend }: Props) {
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const addQuestion = useMutation((api as any).applications.addQuestion);
  const sendApp = useMutation((api as any).applications.send);
  const [saving, setSaving] = useState(false);

  function addFromIntent(intent: Doc<"questionIntents">) {
    setQuestions((prev) => [
      ...prev,
      {
        key: `${intent.intentKey}-${Date.now()}`,
        intentKey: intent.intentKey,
        prompt: intent.defaultPrompt,
        answerType: intent.answerType,
        required: true,
      },
    ]);
  }

  function addCustom() {
    if (!customPrompt.trim()) return;
    setQuestions((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        prompt: customPrompt.trim(),
        answerType: "text",
        required: true,
      },
    ]);
    setCustomPrompt("");
  }

  function remove(key: string) {
    setQuestions((prev) => prev.filter((q) => q.key !== key));
  }

  async function handleSend() {
    setSaving(true);
    try {
      for (const q of questions) {
        await addQuestion({
          applicationId,
          intentKey: q.intentKey,
          prompt: q.prompt,
          answerType: q.answerType,
          required: q.required,
        });
      }
      await sendApp({ applicationId });
      onSend();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {questions.map((q) => (
          <div
            key={q.key}
            className="flex items-start gap-2 p-2 rounded border border-foreground/10 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{q.prompt}</div>
              <div className="text-xs text-muted-foreground">
                {q.intentKey ?? "custom"} · {q.answerType}
              </div>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground text-xs shrink-0"
              onClick={() => remove(q.key)}
            >
              Remove
            </button>
          </div>
        ))}
        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        )}
      </div>

      {showPicker ? (
        <QuestionIntentPicker
          onSelect={addFromIntent}
          onClose={() => setShowPicker(false)}
        />
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPicker(true)}
          >
            + From catalog
          </Button>
          <div className="flex gap-1 flex-1">
            <Input
              placeholder="Custom question…"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
              size={1}
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={addCustom}>
              Add
            </Button>
          </div>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleSend}
        disabled={questions.length === 0 || saving}
      >
        {saving ? "Sending…" : "Send Application"}
      </Button>
    </div>
  );
}
