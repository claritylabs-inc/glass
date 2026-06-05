import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function OperationalPanel({
  className,
  as: Component = "section",
  children,
  ...props
}: {
  className?: string;
  as?: "div" | "section";
  children: ReactNode;
} & ComponentPropsWithoutRef<"div"> &
  ComponentPropsWithoutRef<"section">) {
  return (
    <Component
      className={cn(
        "w-full overflow-hidden rounded-lg border border-foreground/6 bg-card",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

function OperationalPanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start justify-between gap-4 border-b border-foreground/6 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="min-w-0 truncate text-base font-medium leading-5 text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function OperationalPanelBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

function OperationalItem({
  className,
  children,
  ...props
}: {
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "border-t border-foreground/6 px-4 py-3 first:border-t-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function OperationalDetailGroup({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title ? (
        <h3 className="mb-2 text-label font-medium text-muted-foreground">
          {title}
        </h3>
      ) : null}
      <OperationalPanel as="div" className="px-3 py-0.5">
        {children}
      </OperationalPanel>
    </section>
  );
}

function OperationalDetailRow({
  label,
  value,
}: {
  label: string;
  value?: ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-foreground/6 py-3 first:border-t-0">
      <p className="text-label text-muted-foreground">{label}</p>
      <p className="min-w-0 break-words text-base leading-5 text-foreground">
        {value}
      </p>
    </div>
  );
}

function OperationalLabelValueList({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
}) {
  return (
    <OperationalPanel as="div" className={className}>
      {title ? (
        <OperationalPanelHeader title={title} />
      ) : null}
      <dl>{children}</dl>
    </OperationalPanel>
  );
}

function OperationalLabelValueRow({
  label,
  value,
  align = "left",
}: {
  label: ReactNode;
  value?: ReactNode;
  align?: "left" | "right";
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid grid-cols-[minmax(7.5rem,0.32fr)_minmax(0,1fr)] gap-3 border-t border-foreground/6 px-4 py-3 first:border-t-0">
      <dt className="min-w-0 text-base font-normal text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-base leading-5 text-foreground",
          align === "right" && "text-right",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function OperationalSkeletonList({
  rows = 6,
  showTrailing = true,
  className,
}: {
  rows?: number;
  showTrailing?: boolean;
  className?: string;
}) {
  return (
    <OperationalPanel as="div" className={className}>
      {Array.from({ length: rows }).map((_, index) => (
        <OperationalItem key={index} className="border-foreground/4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            {showTrailing ? (
              <>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-16 rounded-full" />
              </>
            ) : null}
          </div>
        </OperationalItem>
      ))}
    </OperationalPanel>
  );
}

export {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalItem,
  OperationalDetailGroup,
  OperationalDetailRow,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalSkeletonList,
};
