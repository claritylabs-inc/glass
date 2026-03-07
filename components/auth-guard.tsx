"use client";

import { useConvexAuth } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const PUBLIC_PATHS = ["/login"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, isPublic, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated && !isPublic) {
    return null;
  }

  return <>{children}</>;
}
