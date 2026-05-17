"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { CSSProperties, ElementType } from "react";
import { memo, useMemo } from "react";

const motionComponents = {
  div: motion.div,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  p: motion.p,
  span: motion.span,
};

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent =
    motionComponents[Component as keyof typeof motionComponents] ?? motion.span;

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: "-50% center, 0% center" }}
      className={cn(
        "relative inline-block bg-clip-text text-transparent",
        className
      )}
      initial={{ backgroundPosition: "150% center, 0% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--shimmer-highlight, var(--color-background)), transparent calc(50% + var(--spread))), linear-gradient(var(--shimmer-base, var(--color-muted-foreground)), var(--shimmer-base, var(--color-muted-foreground)))",
          backgroundSize: "250% 100%, 100% 100%",
          backgroundRepeat: "no-repeat, no-repeat",
          WebkitBackgroundClip: "text",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
