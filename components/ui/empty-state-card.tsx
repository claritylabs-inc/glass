import type { ReactNode } from "react";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  secondary,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <OperationalPanel
      as="div"
      className="flex flex-col items-center gap-3 p-8 text-center"
    >
      {icon ? (
        <div className="text-muted-foreground/60 mb-1">{icon}</div>
      ) : null}
      <h3 className="text-base font-medium">{title}</h3>
      {description ? (
        <p className="text-base text-muted-foreground max-w-md">
          {description}
        </p>
      ) : null}
      {actionLabel && onAction ? (
        <div className="mt-2 flex items-center gap-2">
          <PillButton
            type="button"
            variant="primary"
            size="compact"
            onClick={onAction}
          >
            {actionLabel}
          </PillButton>
          {secondary}
        </div>
      ) : secondary ? (
        <div className="mt-2">{secondary}</div>
      ) : null}
    </OperationalPanel>
  );
}
