import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function FormSection({
  title,
  description,
  action,
  children,
  divided = true,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  divided?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3",
        divided && "border-t border-foreground/6 pt-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium leading-5 text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-base leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export { FormSection };
