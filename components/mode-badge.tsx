export function ModeBadge({ mode }: { mode: "direct" | "cc" | "forward" | "unknown" | "application" }) {
  const styles = {
    direct: "bg-violet-50 text-violet-600",
    cc: "bg-sky-50 text-sky-600",
    forward: "bg-teal-50 text-teal-600",
    unknown: "bg-amber-50 text-amber-600",
    application: "bg-rose-50 text-rose-600",
  };
  const labels = { direct: "Direct", cc: "CC", forward: "Forward", unknown: "Unknown", application: "Application" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[mode]}`}>
      {labels[mode]}
    </span>
  );
}
