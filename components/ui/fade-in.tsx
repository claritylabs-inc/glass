"use client";

import { motion, useReducedMotion } from "framer-motion";

const STAGGER_INTERVAL = 0.025;
const MAX_DURATION = 0.14;

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  staggerIndex?: number;
  direction?: "up" | "none";
  when?: boolean;
  as?: keyof typeof motion;
  duration?: number;
  onClick?: () => void;
}

export function FadeIn({
  children,
  className = "",
  delay,
  staggerIndex,
  direction = "up",
  when,
  as: Component = "div",
  duration = 0.12,
  onClick,
}: FadeInProps) {
  const reduceMotion = useReducedMotion();
  const resolvedDelay = reduceMotion
    ? 0
    : (delay ??
      (staggerIndex !== undefined ? staggerIndex * STAGGER_INTERVAL : 0));
  const initial = {
    opacity: 0,
    y: direction === "up" ? 4 : 0,
  };
  const animate = {
    opacity: 1,
    y: 0,
  };

  const MotionComponent = motion[Component] as typeof motion.div;

  return (
    <MotionComponent
      initial={reduceMotion ? false : initial}
      {...(when !== undefined
        ? { animate: when ? animate : initial }
        : { whileInView: animate, viewport: { once: true, margin: "-100px" } })}
      transition={{
        duration: reduceMotion ? 0 : Math.min(duration, MAX_DURATION),
        delay: resolvedDelay,
        ease: [0.2, 0, 0, 1],
      }}
      className={className}
      onClick={onClick}
    >
      {children}
    </MotionComponent>
  );
}
