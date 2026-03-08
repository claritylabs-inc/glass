"use client";

import { useConvexAuth } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Nav } from "@/components/nav";
import { Skeleton } from "@/components/ui/skeleton";

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
    if (isPublic) return null;
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
            <div className="mb-6">
              <Skeleton className="h-7 w-48 mb-2" />
              <Skeleton className="h-4 w-72" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated && !isPublic) {
    return null;
  }

  return <>{children}</>;
}
