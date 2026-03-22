import { MessageCircle } from "lucide-react";

export function ModeBadge({ mode }: { mode: "direct" | "cc" | "forward" | "unknown" | "application" | "chat" }) {
  const styles = {
    direct: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
    cc: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    forward: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
    unknown: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    application: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
    chat: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  };
  const labels = { direct: "Direct", cc: "CC", forward: "Forward", unknown: "Unknown", application: "Application", chat: "Chat" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[mode]}`}>
      {mode === "chat" && <MessageCircle className="w-2.5 h-2.5" />}
      {labels[mode]}
    </span>
  );
}
