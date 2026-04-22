"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrefillChip } from "./prefill-chip";
import { QuestionFieldBadges } from "./question-field-badges";
import type { Doc } from "@/convex/_generated/dataModel";

type Answer = Doc<"applicationAnswers"> | undefined;
type Flag = Doc<"applicationQuestionFlags">;

type Props = {
  question: Doc<"applicationQuestions">;
  answer: Answer;
  flags: Flag[];
  onChange: (value: unknown, source?: "manual") => void;
  label?: string;
  inputName?: string;
};

export function QuestionField({ question, answer, flags, onChange, label, inputName }: Props) {
  const value = answer?.value;
  const source = answer?.source;
  const override = answer?.overrideOfIntegration;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-foreground">
          {label ?? question.prompt}
          {question.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {source && (
          <PrefillChip
            source={source}
            override={override ?? null}
            onRevert={() => onChange(override?.syncedValue, undefined)}
          />
        )}
      </div>

      {question.helpText && (
        <p className="text-xs text-muted-foreground">{question.helpText}</p>
      )}

      <FieldInput
        answerType={question.answerType}
        value={value}
        selectOptions={question.selectOptions}
        inputName={inputName ?? `q-${question._id}`}
        onChange={(v) => onChange(v, "manual")}
      />

      <QuestionFieldBadges flags={flags} />
    </div>
  );
}

function FieldInput({
  answerType,
  value,
  selectOptions,
  inputName,
  onChange,
}: {
  answerType: string;
  value: unknown;
  selectOptions?: { value: string; label: string }[];
  inputName: string;
  onChange: (v: unknown) => void;
}) {
  switch (answerType) {
    case "text":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "long_text":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      );
    case "number":
    case "currency":
    case "percent":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "yes_no":
      return (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name={`yn-${inputName}`}
              checked={value === true}
              onChange={() => onChange(true)}
            />
            Yes
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name={`yn-${inputName}`}
              checked={value === false}
              onChange={() => onChange(false)}
            />
            No
          </label>
        </div>
      );
    case "select":
      return (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(selectOptions ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_select":
      return (
        <div className="flex flex-col gap-1.5">
          {(selectOptions ?? []).map((o) => {
            const selected =
              Array.isArray(value) && (value as string[]).includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    const prev = Array.isArray(value) ? (value as string[]) : [];
                    onChange(
                      e.target.checked
                        ? [...prev, o.value]
                        : prev.filter((v) => v !== o.value),
                    );
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`(${answerType})`}
        />
      );
  }
}
