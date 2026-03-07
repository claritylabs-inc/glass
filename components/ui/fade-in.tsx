"use client";

import { motion } from "framer-motion";

const STAGGER_INTERVAL = 0.16;

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  staggerIndex?: number;
  direction?: "up" | "none";
  when?: boolean;
  as?: keyof typeof motion;
  duration?: number;
}

export function FadeIn({
  children,
  className = "",
  delay,
  staggerIndex,
  direction = "up",
  when,
  as: Component = "div",
  duration = 1.5,
}: FadeInProps) {
  const resolvedDelay =
    delay ?? (staggerIndex !== undefined ? staggerIndex * STAGGER_INTERVAL : 0.05);
  const initial = {
    opacity: 0,
    y: direction === "up" ? 18 : 0,
    filter: "blur(4px)",
  };
  const animate = {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
  };

  const MotionComponent = motion[Component] as typeof motion.div;

  return (
    <MotionComponent
      initial={initial}
      {...(when !== undefined
        ? { animate: when ? animate : initial }
        : { whileInView: animate, viewport: { once: true, margin: "-100px" } })}
      transition={{
        duration,
        delay: resolvedDelay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </MotionComponent>
  );
}
