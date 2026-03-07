"use client";

import { forwardRef, useState } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type PillButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "icon";

interface PillButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  variant?: PillButtonVariant;
  children?: React.ReactNode;
}

const EASE_OUT = [0.33, 1, 0.68, 1] as const;
const DURATION = 0.33;

const variantConfig = {
  primary: {
    classes:
      "text-white font-medium shadow-lg shadow-black/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "var(--foreground)" },
    hover: { backgroundColor: "#2d3748" },
  },
  secondary: {
    classes:
      "border border-foreground/8 bg-white font-medium text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: {},
    hover: { borderColor: "rgba(17,24,39,0.15)" },
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
    hover: { backgroundColor: "rgba(17,24,39,0.05)" },
  },
  icon: {
    classes:
      "text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    rest: { backgroundColor: "transparent" },
    hover: { backgroundColor: "rgba(17,24,39,0.06)" },
  },
};

const PAD_REST = 20;
const PAD_HOVER = 24;
const GAP_REST = 8;
const GAP_HOVER = 12;

const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ variant = "primary", className, disabled, children, ...props }, ref) => {
    const [hovered, setHovered] = useState(false);
    const vc = variantConfig[variant];
    const isIcon = variant === "icon";

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={disabled}
        onHoverStart={() => !disabled && setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        initial={false}
        animate={{
          ...(isIcon ? {} : { paddingLeft: PAD_REST, paddingRight: PAD_REST }),
          ...vc.rest,
        }}
        whileHover={
          disabled
            ? undefined
            : {
                ...(isIcon ? {} : { paddingLeft: PAD_HOVER, paddingRight: PAD_HOVER }),
                scale: 1.02,
                ...vc.hover,
              }
        }
        whileTap={disabled ? undefined : { scale: 0.98 }}
        transition={{ duration: DURATION, ease: EASE_OUT }}
        style={isIcon ? undefined : { fontSize: "var(--text-label)" }}
        className={cn(
          "inline-flex items-center justify-center rounded-full select-none outline-none overflow-hidden",
          isIcon ? "w-8 h-8 p-0" : "py-2",
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
            animate={{ gap: `${hovered && !disabled ? GAP_HOVER : GAP_REST}px` }}
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

export { PillButton, type PillButtonProps, type PillButtonVariant };
