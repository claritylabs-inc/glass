"use client";

import { useEffect } from "react";
import { createSmoothCornersEngine } from "@/lib/smooth-corners/engine";

export function SmoothCornersProvider() {
  useEffect(() => {
    const engine = createSmoothCornersEngine();
    return () => engine.destroy();
  }, []);

  return null;
}
