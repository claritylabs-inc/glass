"use client";

import { usePathname } from "next/navigation";
import { PoweredByGlassWordmark } from "@/components/auth-shell";

const HIDDEN_PREFIXES = ["/login", "/signup", "/invite"];

export function PoweredByFooter() {
  const pathname = usePathname();
  if (!pathname) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }
  return (
    <div className="fixed bottom-3 left-0 right-0 flex justify-center pointer-events-none opacity-70 z-10">
      <PoweredByGlassWordmark />
    </div>
  );
}
