"use client";

import {
  forwardRef,
  type MouseEvent,
  type Ref,
  type ReactNode,
} from "react";
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

type CommonPillButtonProps = {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  label?: string;
  children?: ReactNode;
};

type PillButtonButtonProps = CommonPillButtonProps &
  Omit<HTMLMotionProps<"button">, "children" | "ref" | "type"> & {
    href?: never;
    type?: "button" | "submit" | "reset";
  };

type PillButtonAnchorProps = CommonPillButtonProps &
  Omit<HTMLMotionProps<"a">, "children" | "ref"> & {
    href: string;
    disabled?: boolean;
  };

type PillButtonProps = PillButtonButtonProps | PillButtonAnchorProps;

const MOTION_TRANSITION = {
  duration: 0.08,
  ease: [0.2, 0, 0, 1] as const,
};

type VariantConfig = {
  classes: string;
  hover?: HTMLMotionProps<"button">["whileHover"];
  tap?: HTMLMotionProps<"button">["whileTap"];
};

const variantConfig: Record<PillButtonVariant, VariantConfig> = {
  primary: {
    classes:
      "[--pill-primary-bg:var(--brand,#000000)] [--pill-primary-fg:var(--brand-foreground,#ffffff)] dark:[--pill-primary-bg:var(--foreground)] dark:[--pill-primary-fg:var(--background)] !bg-[var(--pill-primary-bg)] ![color:var(--pill-primary-fg)] hover:!bg-[color-mix(in_srgb,var(--pill-primary-bg)_86%,var(--background))] hover:ring-1 hover:ring-foreground/10 active:!bg-[color-mix(in_srgb,var(--pill-primary-bg)_76%,var(--background))]",
    tap: { scale: 0.98 },
  },
  secondary: {
    classes:
      "border border-foreground/8 bg-transparent text-muted-foreground hover:border-foreground/14 hover:bg-foreground/[0.03] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  destructive: {
    classes:
      "bg-red-500/10 text-destructive hover:bg-red-500/15 hover:text-red-600",
    tap: { opacity: 0.78 },
  },
  ghost: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  icon: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  iconLabel: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
};

const sizeClasses: Record<PillButtonSize, string> = {
  default: "h-8 px-5 gap-2 text-label",
  compact: "h-7 px-3 gap-1.5 text-label",
};

const iconSizeClasses: Record<PillButtonSize, string> = {
  default: "h-8 w-8 p-0",
  compact: "h-7 w-7 p-0",
};

const PillButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, PillButtonProps>(
  (
    {
      variant = "primary",
      size = "default",
      label,
      className,
      children,
      "aria-label": ariaLabel,
      title,
      ...props
    },
    ref,
  ) => {
    const isIcon = variant === "icon";
    const showsLabel = variant === "iconLabel" && label;
    const config = variantConfig[variant];
    const disabled = "disabled" in props && Boolean(props.disabled);
    const content = (
      <>
        {children}
        {showsLabel ? <span>{label}</span> : null}
      </>
    );
    const classes = cn(
      "inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none outline-none transition-colors duration-150 ease-out select-none focus-visible:ring-2 focus-visible:ring-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:text-current",
      config.classes,
      isIcon ? iconSizeClasses[size] : sizeClasses[size],
      className,
    );

    if ("href" in props && props.href) {
      const { disabled: _disabled, onClick, tabIndex, ...anchorProps } = props;
      return (
        <motion.a
          ref={ref as Ref<HTMLAnchorElement>}
          aria-disabled={disabled || undefined}
          aria-label={ariaLabel ?? label}
          className={classes}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (disabled) {
              event.preventDefault();
              return;
            }
            onClick?.(event);
          }}
          tabIndex={disabled ? -1 : tabIndex}
          title={title ?? (isIcon ? label : undefined)}
          transition={MOTION_TRANSITION}
          whileHover={disabled ? undefined : config.hover}
          whileTap={disabled ? undefined : config.tap}
          {...anchorProps}
        >
          {content}
        </motion.a>
      );
    }

    const { type = "button", ...buttonProps } = props as PillButtonButtonProps;

    return (
      <motion.button
        ref={ref as Ref<HTMLButtonElement>}
        type={type}
        aria-label={ariaLabel ?? label}
        title={title ?? (isIcon ? label : undefined)}
        whileHover={disabled ? undefined : config.hover}
        whileTap={disabled ? undefined : config.tap}
        transition={MOTION_TRANSITION}
        className={classes}
        {...buttonProps}
      >
        {content}
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
