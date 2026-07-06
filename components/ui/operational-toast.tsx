"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  PillButton,
  type PillButtonVariant,
} from "@/components/ui/pill-button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const DEFAULT_COLLAPSE_DELAY_MS = 3_500;

type OperationalToastTone = "loading" | "success" | "error";

type OperationalToastAction = {
  id?: string;
  label: string;
  onClick: () => void;
  variant?: PillButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
};

type OperationalStatusToastProps = {
  title: string;
  description?: string;
  tone: OperationalToastTone;
  actions?: OperationalToastAction[];
  collapsible?: boolean;
  collapseDelayMs?: number;
  className?: string;
};

type ShowOperationalStatusToastOptions = OperationalStatusToastProps & {
  id: string;
  duration: number;
};

function OperationalToastIcon({ tone }: { tone: OperationalToastTone }) {
  if (tone === "loading") {
    return <Spinner className="size-4 text-muted-foreground" />;
  }

  if (tone === "error") {
    return <CircleAlert className="size-4 text-destructive" />;
  }

  return <CircleCheck className="size-4 text-muted-foreground" />;
}

function actionSignature(actions: OperationalToastAction[] | undefined) {
  return actions
    ?.map((action) =>
      [
        action.id ?? action.label,
        action.variant ?? "secondary",
        action.disabled ? "disabled" : "enabled",
      ].join(":"),
    )
    .join("|");
}

function OperationalToastActionButton({
  action,
}: {
  action: OperationalToastAction;
}) {
  return (
    <PillButton
      size="compact"
      variant={action.variant ?? "secondary"}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.icon}
      {action.label}
    </PillButton>
  );
}

function OperationalStatusToast({
  title,
  description,
  tone,
  actions = [],
  collapsible = false,
  collapseDelayMs = DEFAULT_COLLAPSE_DELAY_MS,
  className,
}: OperationalStatusToastProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const hasRevealContent = Boolean(description || actions.length);
  const accessibleLabel = description ? `${title}. ${description}` : title;
  const signature = useMemo(() => actionSignature(actions), [actions]);

  useEffect(() => {
    if (!collapsible || !hasRevealContent) return;

    const collapseTimer = window.setTimeout(() => {
      setIsCollapsed(true);
    }, collapseDelayMs);

    return () => window.clearTimeout(collapseTimer);
  }, [
    collapsible,
    collapseDelayMs,
    description,
    hasRevealContent,
    signature,
    title,
    tone,
  ]);

  return (
    <div
      className={cn("glass-operational-toast", className)}
      data-collapsible={collapsible || undefined}
      data-collapsed={collapsible && hasRevealContent && isCollapsed}
      tabIndex={collapsible && hasRevealContent ? 0 : undefined}
      aria-label={accessibleLabel}
    >
      <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-3">
        <div
          className={cn(
            "flex h-5 items-center justify-center",
            tone === "loading" ? "pt-0.5" : "pt-px",
          )}
        >
          <OperationalToastIcon tone={tone} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-medium leading-5 text-foreground">
            {title}
          </p>
        </div>
      </div>

      {hasRevealContent ? (
        <div className="glass-operational-toast__reveal">
          <div className="glass-operational-toast__reveal-inner">
            {description ? (
              <p className="text-label leading-4 text-muted-foreground">
                {description}
              </p>
            ) : null}

            {actions.length ? (
              <div className={cn("flex flex-wrap gap-2", description && "mt-3")}>
                {actions.map((action) => (
                  <OperationalToastActionButton
                    key={action.id ?? action.label}
                    action={action}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function showOperationalStatusToast({
  id,
  duration,
  ...toastProps
}: ShowOperationalStatusToastOptions) {
  toast.custom(
    () => (
      <OperationalStatusToast
        key={[
          toastProps.collapsible ? "collapsible" : "fixed",
          toastProps.tone,
          toastProps.title,
          toastProps.description ?? "",
          actionSignature(toastProps.actions),
        ].join(":")}
        {...toastProps}
      />
    ),
    { id, duration },
  );
}

export {
  OperationalStatusToast,
  showOperationalStatusToast,
  type OperationalStatusToastProps,
  type OperationalToastAction,
  type OperationalToastTone,
};
