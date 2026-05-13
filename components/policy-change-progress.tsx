import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const POLICY_CHANGE_STEPS = [
  { label: "Requested", detail: "Request received" },
  { label: "Review", detail: "Checking details" },
  { label: "Ready", detail: "Ready for broker submission" },
  { label: "Submitted", detail: "Sent to the broker or carrier" },
  { label: "Complete", detail: "Change resolved" },
];

export function formatPolicyChangeStatus(status?: string) {
  if (!status) return "Request";
  return status.replace(/_/g, " ");
}

export function isPolicyChangeTerminal(status?: string) {
  return status === "accepted" || status === "declined" || status === "cancelled";
}

function policyChangeProgress(status?: string) {
  switch (status) {
    case "draft":
      return 1;
    case "needs_info":
      return 2;
    case "ready":
      return 3;
    case "submitted":
      return 4;
    case "accepted":
      return 5;
    case "declined":
    case "cancelled":
      return 0;
    default:
      return 1;
  }
}

export function PolicyChangeProgress({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  if (status === "cancelled") return null;

  const completed = policyChangeProgress(status);
  const interrupted = status === "declined" || status === "cancelled";

  return (
    <div className={className}>
      <div className="space-y-2">
        {POLICY_CHANGE_STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const active = !interrupted && stepNumber <= completed;
          const current = !interrupted && stepNumber === completed;
          const done = !interrupted && stepNumber < completed;

          return (
            <div
              key={step.label}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3 sm:items-center",
                current
                  ? "border-foreground/14 bg-foreground/[0.025]"
                  : "border-foreground/6 bg-card",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium leading-none tabular-nums",
                  done
                    ? "bg-foreground text-background"
                    : current
                      ? "border border-foreground bg-background text-foreground"
                      : "border border-foreground/8 bg-foreground/5 text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : stepNumber}
              </span>

              <div className="flex w-full min-w-0 flex-1 flex-col gap-1 text-body-sm sm:flex-row sm:items-center sm:gap-x-2">
                <div
                  className={cn(
                    "shrink-0 truncate font-medium",
                    current
                      ? "text-foreground"
                      : active
                        ? "text-foreground/80"
                        : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </div>
                <span className="mx-2 hidden shrink-0 text-muted-foreground/45 sm:inline">—</span>
                <div className="min-w-0 truncate text-muted-foreground sm:flex-1">
                  {step.detail}
                </div>
              </div>

              {current ? (
                <span className="shrink-0 rounded-full border border-foreground/8 px-2 py-0.5 text-body-sm font-medium text-muted-foreground">
                  Current
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {interrupted ? (
        <p className="mt-2 text-label-sm text-muted-foreground">
          This request is {formatPolicyChangeStatus(status)}.
        </p>
      ) : null}
    </div>
  );
}
