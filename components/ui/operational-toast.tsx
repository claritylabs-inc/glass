"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  PillButton,
  type PillButtonVariant,
} from "@/components/ui/pill-button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

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
  className,
}: OperationalStatusToastProps) {
  const accessibleLabel = description ? `${title}. ${description}` : title;
  const inlineAction = actions.length === 1 ? actions[0] : undefined;

  return (
    <div
      className={cn(
        "glass-operational-toast grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5",
        className,
      )}
      aria-label={accessibleLabel}
    >
      <div
        className={cn(
          "flex h-5 self-start items-center justify-center",
          tone === "loading" ? "pt-0.5" : "pt-px",
        )}
      >
        <OperationalToastIcon tone={tone} />
      </div>

      <div className={cn("min-w-0", !inlineAction && "col-span-2")}>
        <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
          {title}
        </p>
        {description ? (
          <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
            {description}
          </p>
        ) : null}
      </div>

      {inlineAction ? (
        <OperationalToastActionButton action={inlineAction} />
      ) : null}

      {actions.length > 1 ? (
        <div className="col-span-2 col-start-2 flex flex-wrap gap-2 pt-2">
          {actions.map((action) => (
            <OperationalToastActionButton
              key={action.id ?? action.label}
              action={action}
            />
          ))}
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
