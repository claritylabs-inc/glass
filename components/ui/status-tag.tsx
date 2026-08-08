import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusTagVariants = cva("border", {
  variants: {
    tone: {
      neutral:
        "border-foreground/10 bg-foreground/[0.04] text-muted-foreground",
      info: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      success:
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      warning:
        "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      danger:
        "border-destructive/20 bg-destructive/10 text-destructive dark:bg-destructive/15",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

type StatusTagProps = Omit<ComponentProps<typeof Badge>, "variant"> &
  VariantProps<typeof statusTagVariants>;
type StatusTagTone = NonNullable<StatusTagProps["tone"]>;

function StatusTag({
  className,
  tone = "neutral",
  ...props
}: StatusTagProps) {
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn(statusTagVariants({ tone }), className)}
      {...props}
    />
  );
}

export { StatusTag, statusTagVariants };
export type { StatusTagProps, StatusTagTone };
