"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

const EASE_OUT = [0.33, 1, 0.68, 1] as const;
const HOVER_DURATION = 0.33;

interface CTAButtonProps {
  label: string;
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
}

export function CTAButton({
  label,
  onClick,
  href,
  target,
  rel,
  className = "",
}: CTAButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (href) {
      e.preventDefault();
      window.open(href, target ?? "_blank", "noopener,noreferrer");
    }
    onClick?.();
  };

  const gap = isHovered ? 16 : 10;

  const buttonContent = (
    <motion.span
      className="inline-flex items-center"
      initial={{ gap: "10px" }}
      animate={{ gap: `${gap}px` }}
      transition={{ duration: HOVER_DURATION, ease: EASE_OUT }}
    >
      <span className="whitespace-nowrap">{label}</span>
      <ArrowRight className="w-3 h-3 shrink-0" />
    </motion.span>
  );

  const commonProps = {
    onClick: handleClick,
    onHoverStart: () => setIsHovered(true),
    onHoverEnd: () => setIsHovered(false),
    initial: false as const,
    animate: {
      paddingLeft: 24,
      paddingRight: 24,
      backgroundColor: "var(--foreground)",
    },
    transition: { duration: HOVER_DURATION, ease: EASE_OUT },
    whileHover: {
      paddingLeft: 28,
      paddingRight: 28,
      scale: 1.02,
      backgroundColor: "#2d3748",
    },
    className:
      `inline-flex items-center justify-center h-9 rounded-full text-sm font-medium text-background shadow-lg shadow-black/10 cursor-pointer overflow-hidden ${className}`.trim(),
  };

  if (href) {
    return (
      <motion.a href={href} target={target} rel={rel} {...commonProps}>
        {buttonContent}
      </motion.a>
    );
  }

  return (
    <motion.button type="button" {...commonProps}>
      {buttonContent}
    </motion.button>
  );
}
