"use client";

import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type PillButtonVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "ghost"
  | "icon"
  | "iconLabel";
type PillButtonSize = "default" | "compact";

interface PillButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "ref" | "children"
> {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  label?: string;
  children?: ReactNode;
}

const MOTION_TRANSITION = {
  duration: 0.16,
  ease: [0.22, 1, 0.36, 1] as const,
};

type VariantConfig = {
  classes: string;
  hover?: HTMLMotionProps<"button">["whileHover"];
  tap?: HTMLMotionProps<"button">["whileTap"];
};

const variantConfig: Record<PillButtonVariant, VariantConfig> = {
  primary: {
    classes:
      "bg-brand !text-white dark:!text-black hover:bg-[color-mix(in_srgb,var(--brand)_68%,var(--background))] hover:ring-1 hover:ring-foreground/10 active:bg-[color-mix(in_srgb,var(--brand)_56%,var(--background))]",
  },
  secondary: {
    classes:
      "border border-foreground/8 bg-transparent text-muted-foreground hover:border-foreground/14 hover:bg-foreground/[0.03] hover:text-foreground",
    hover: { filter: "brightness(0.98)" },
    tap: { opacity: 0.78 },
  },
  destructive: {
    classes:
      "bg-red-500/10 text-destructive hover:bg-red-500/15 hover:text-red-600",
    hover: { filter: "brightness(0.98)" },
    tap: { opacity: 0.78 },
  },
  ghost: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    hover: { filter: "brightness(0.98)" },
    tap: { opacity: 0.78 },
  },
  icon: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    hover: { filter: "brightness(0.98)" },
    tap: { opacity: 0.78 },
  },
  iconLabel: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    hover: { filter: "brightness(0.98)" },
    tap: { opacity: 0.78 },
  },
};

const sizeClasses: Record<PillButtonSize, string> = {
  default: "h-8 px-5 gap-2 text-label",
  compact: "h-7 px-3 gap-1.5 text-[11px]",
};

const iconSizeClasses: Record<PillButtonSize, string> = {
  default: "h-8 w-8 p-0",
  compact: "h-7 w-7 p-0",
};

const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  (
    {
      variant = "primary",
      size = "default",
      label,
      className,
      children,
      type = "button",
      "aria-label": ariaLabel,
      title,
      ...props
    },
    ref,
  ) => {
    const isIcon = variant === "icon";
    const showsLabel = variant === "iconLabel" && label;
    const config = variantConfig[variant];

    return (
      <motion.button
        ref={ref}
        type={type}
        aria-label={ariaLabel ?? label}
        title={title ?? (isIcon ? label : undefined)}
        whileHover={props.disabled ? undefined : config.hover}
        whileTap={props.disabled ? undefined : config.tap}
        transition={MOTION_TRANSITION}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-medium outline-none transition-colors duration-150 ease-out select-none focus-visible:ring-2 focus-visible:ring-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:text-current",
          config.classes,
          isIcon ? iconSizeClasses[size] : sizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
        {showsLabel ? <span>{label}</span> : null}
      </motion.button>
    );
  },
);

PillButton.displayName = "PillButton";

export {
  PillButton,
  type PillButtonProps,
  type PillButtonVariant,
  type PillButtonSize,
};
