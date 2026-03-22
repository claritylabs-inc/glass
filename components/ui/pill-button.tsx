"use client";

import { forwardRef, useState, useRef, useEffect } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type PillButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "icon";
type PillButtonSize = "default" | "compact";

interface PillButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  /** For icon variant: hover label that expands from the icon */
  label?: string;
  children?: React.ReactNode;
}

const EASE_OUT = [0.33, 1, 0.68, 1] as const;
const DURATION = 0.32;

const variantConfig = {
  primary: {
    classes:
      "font-medium shadow-lg shadow-black/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "var(--foreground)", color: "var(--background)" },
    hover: { filter: "brightness(1.15)" },
  },
  secondary: {
    classes:
      "border border-foreground/8 bg-popover font-medium text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: {},
    hover: { borderColor: "var(--input)" },
  },
  destructive: {
    classes:
      "font-medium text-destructive cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "rgba(239,68,68,0.1)" },
    hover: { backgroundColor: "rgba(239,68,68,0.2)" },
  },
  ghost: {
    classes:
      "font-medium text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "transparent" },
    hover: { backgroundColor: "var(--accent)" },
  },
  icon: {
    classes:
      "text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "transparent" },
    hover: { backgroundColor: "var(--accent)" },
  },
};

const PAD_REST = 20;
const PAD_HOVER = 24;
const GAP_REST = 8;
const GAP_HOVER = 12;

// Compact size constants
const COMPACT_PAD_REST = 12;
const COMPACT_PAD_HOVER = 16;
const COMPACT_GAP_REST = 5;
const COMPACT_GAP_HOVER = 7;

// Icon expand constants
const ICON_COLLAPSED = 32; // w-8
const ICON_PAD_X = 14;
const ICON_GAP = 8;
const ICON_SIZE = 16; // w-4

const COMPACT_ICON_COLLAPSED = 26;
const COMPACT_ICON_PAD_X = 10;
const COMPACT_ICON_GAP = 5;

const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ variant = "primary", size = "default", label, className, disabled, children, ...props }, ref) => {
    const [hovered, setHovered] = useState(false);
    const vc = variantConfig[variant];
    const isIcon = variant === "icon";
    const isCompact = size === "compact";
    const hasLabel = isIcon && !!label;

    // Measure label text width for smooth expand
    const labelRef = useRef<HTMLSpanElement>(null);
    const [labelWidth, setLabelWidth] = useState(0);
    useEffect(() => {
      if (hasLabel && labelRef.current) {
        setLabelWidth(labelRef.current.scrollWidth);
      }
    }, [label, hasLabel]);

    const iconCollapsed = isCompact ? COMPACT_ICON_COLLAPSED : ICON_COLLAPSED;
    const iconPadX = isCompact ? COMPACT_ICON_PAD_X : ICON_PAD_X;
    const iconGap = isCompact ? COMPACT_ICON_GAP : ICON_GAP;
    const expandedWidth = iconPadX * 2 + ICON_SIZE + iconGap + labelWidth;

    const padRest = isCompact ? COMPACT_PAD_REST : PAD_REST;
    const padHover = isCompact ? COMPACT_PAD_HOVER : PAD_HOVER;
    const gapRest = isCompact ? COMPACT_GAP_REST : GAP_REST;
    const gapHover = isCompact ? COMPACT_GAP_HOVER : GAP_HOVER;

    if (hasLabel) {
      return (
        <motion.button
          ref={ref}
          type="button"
          disabled={disabled}
          onHoverStart={() => !disabled && setHovered(true)}
          onHoverEnd={() => setHovered(false)}
          initial={false}
          animate={{
            width: hovered && !disabled ? expandedWidth : iconCollapsed,
            ...vc.rest,
          }}
          whileHover={disabled ? undefined : { scale: 1.02, ...vc.hover }}
          whileTap={disabled ? undefined : { scale: 0.98 }}
          transition={{ duration: DURATION, ease: EASE_OUT }}
          className={cn(
            "inline-flex items-center justify-center rounded-full select-none outline-none overflow-hidden",
            isCompact ? "h-7" : "h-8",
            vc.classes,
            className,
          )}
          style={{ fontSize: isCompact ? "11px" : "var(--text-label)" }}
          aria-label={label}
          {...props}
        >
          <motion.span
            className="flex items-center min-w-0"
            initial={false}
            animate={{ gap: hovered && !disabled ? `${iconGap}px` : "0px" }}
            transition={{ duration: DURATION, ease: EASE_OUT }}
          >
            {children}
            <motion.span
              ref={labelRef}
              className="whitespace-nowrap overflow-hidden font-medium"
              initial={false}
              animate={{
                opacity: hovered && !disabled ? 1 : 0,
                width: hovered && !disabled ? labelWidth : 0,
              }}
              transition={{
                duration: DURATION,
                ease: EASE_OUT,
                opacity: { delay: hovered && !disabled ? 0.06 : 0 },
              }}
            >
              {label}
            </motion.span>
          </motion.span>
        </motion.button>
      );
    }

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={disabled}
        onHoverStart={() => !disabled && setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        initial={false}
        animate={{
          ...(isIcon ? {} : { paddingLeft: padRest, paddingRight: padRest }),
          ...vc.rest,
        }}
        whileHover={
          disabled
            ? undefined
            : {
                ...(isIcon ? {} : { paddingLeft: padHover, paddingRight: padHover }),
                scale: 1.02,
                ...vc.hover,
              }
        }
        whileTap={disabled ? undefined : { scale: 0.98 }}
        transition={{ duration: DURATION, ease: EASE_OUT }}
        style={isIcon ? undefined : { fontSize: isCompact ? "11px" : "var(--text-label)" }}
        className={cn(
          "inline-flex items-center justify-center rounded-full select-none outline-none overflow-hidden",
          isIcon
            ? isCompact ? "w-7 h-7 p-0" : "w-8 h-8 p-0"
            : isCompact ? "py-1" : "py-2",
          vc.classes,
          className,
        )}
        {...props}
      >
        {isIcon ? (
          children
        ) : (
          <motion.span
            className="inline-flex items-center"
            initial={false}
            animate={{ gap: `${hovered && !disabled ? gapHover : gapRest}px` }}
            transition={{ duration: DURATION, ease: EASE_OUT }}
          >
            {children}
          </motion.span>
        )}
      </motion.button>
    );
  },
);

PillButton.displayName = "PillButton";

export { PillButton, type PillButtonProps, type PillButtonVariant, type PillButtonSize };
