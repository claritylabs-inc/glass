"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ui/status-tag";
import { typeStyle } from "@/lib/typography";

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  lookup_policy: "Searched policies",
  lookup_policy_section: "Read policy sections",
  present_policy_card: "Shared a policy",
  compare_coverages: "Compared coverages",
  save_note: "Saved note",
  generate_coi: "Generated COI",
  attach_policy_document: "Attached policy PDF",
  send_email: "Drafted email",
  email_expert: "Prepared email",
  render_email_preview: "Rendered email preview",
  lookup_connected_vendors: "Checked vendors",
  lookup_vendor_policies: "Read vendor policies",
  lookup_vendor_compliance: "Checked vendor compliance",
  coordinate_mailbox_task: "Coordinated mailbox task",
};

export function formatToolInput(input?: string) {
  if (!input) return "{}";
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

export function ToolCallCard({
  toolCall,
  index,
  showOutput = false,
  displayName: displayNameOverride,
  isRunning = false,
}: {
  toolCall: { name: string; input?: string; output?: string };
  index: number;
  showOutput?: boolean;
  displayName?: string;
  isRunning?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName =
    displayNameOverride ?? TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-foreground/[0.015]">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="h-7 w-full justify-between rounded-none px-2.5 py-1 text-left hover:bg-foreground/[0.03] dark:hover:bg-foreground/[0.06]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span className={`block truncate text-muted-foreground/65 ${typeStyle("caption.medium")}`}>
              {displayName}
            </span>
          </span>
        </span>
        <span className="ml-3 flex shrink-0 items-center gap-2">
          {isRunning ? (
            <StatusTag tone="info" className={`h-4 px-1.5 ${typeStyle("label.tag")}`}>
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Running
            </StatusTag>
          ) : (
            <StatusTag tone="success" className={`h-4 px-1.5 ${typeStyle("label.tag")}`}>
              Completed
            </StatusTag>
          )}
          <span className={`text-muted-foreground/35 ${typeStyle("caption.medium")}`}>
            {isOpen ? "Hide" : "Show"}
          </span>
        </span>
      </Button>
      {isOpen && (
        <div className="space-y-2 border-t border-border px-2.5 pb-2.5 pt-2">
          {showOutput && toolCall.output ? (
            <div>
              <p className={`mb-1 text-muted-foreground/40 ${typeStyle("caption.medium")}`}>
                Output
              </p>
              <pre className={`max-h-64 overflow-auto rounded border border-border bg-background p-2 text-foreground/70 ${typeStyle("technical.codeCompact")}`}>
                <code className="whitespace-pre-wrap break-words">
                  {formatToolInput(toolCall.output)}
                </code>
              </pre>
            </div>
          ) : null}
          {!showOutput || !toolCall.output ? (
            <div>
              <p className={`mb-1 text-muted-foreground/40 ${typeStyle("caption.medium")}`}>
                Parameters
              </p>
              <pre className={`max-h-48 overflow-auto rounded border border-border bg-background p-2 text-foreground/70 ${typeStyle("technical.codeCompact")}`}>
                <code className="whitespace-pre-wrap break-words">
                  {formatToolInput(toolCall.input)}
                </code>
              </pre>
            </div>
          ) : null}
          <span className="sr-only">Tool call {index + 1}</span>
        </div>
      )}
    </div>
  );
}
