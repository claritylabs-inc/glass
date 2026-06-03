import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

import { cn } from "@/lib/utils";

const actionSurfaceClass =
  "rounded-lg border border-foreground/6 bg-card text-left transition-colors hover:bg-foreground/[0.02]";

function ActionSurface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn(actionSurfaceClass, className)} {...props}>
      {children}
    </div>
  );
}

function ActionSurfaceButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button className={cn(actionSurfaceClass, className)} {...props}>
      {children}
    </button>
  );
}

function ActionSurfaceLink({
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
}) {
  return (
    <Link className={cn(actionSurfaceClass, className)} {...props}>
      {children}
    </Link>
  );
}

export { ActionSurface, ActionSurfaceButton, ActionSurfaceLink };
