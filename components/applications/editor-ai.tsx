"use client";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Id } from "@/convex/_generated/dataModel";

type Props = {
  applicationId: Id<"applications">;
  clientOrgId: Id<"organizations">;
  onSend: () => void;
};

type GeneratedQuestion = {
  intentKey?: string;
  customPrompt?: string;
  answerType: string;
  required: boolean;
};

export function EditorAi({ applicationId, clientOrgId, onSend }: Props) {
  const [prompt, setPrompt] = useState("");
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  const generateQuestions = useAction((api as any).actions.applicationAuthoring.generateQuestionSet);
  const addQuestion = useMutation((api as any).applications.addQuestion);
  const sendApp = useMutation((api as any).applications.send);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const result = await generateQuestions({ prompt, clientOrgId }) as GeneratedQuestion[];
      setQuestions(result);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      for (const q of questions) {
        await addQuestion({
          applicationId,
          intentKey: q.intentKey,
          prompt: q.customPrompt ?? q.intentKey ?? "Question",
          answerType: q.answerType,
          required: q.required,
        });
      }
      await sendApp({ applicationId });
      onSend();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Describe the application</label>
        <Input
          placeholder="e.g. CGL application for a roofing contractor in Texas"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          variant="outline"
          className="w-full"
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
        >
          {generating ? "Generating…" : "Generate Question Set"}
        </Button>
      </div>

      {questions.length > 0 && (
        <>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {questions.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 rounded border border-foreground/10 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {q.customPrompt ?? q.intentKey ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">{q.answerType}</div>
                </div>
                <button
                  className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                  onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? "Sending…" : `Send Application (${questions.length} questions)`}
          </Button>
        </>
      )}
    </div>
  );
}
