"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

const PUBLIC_PATHS = ["/login", "/signup"];
const ONBOARDING_PATH = "/onboarding";
const ADMIN_PATHS = ["/settings"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);
  const isOnboarding = pathname === ONBOARDING_PATH;
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));

  // Only query viewer when authenticated
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const viewerOrg = useQuery(api.orgs.viewerOrg, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated && !isPublic) {
      router.replace("/login");
      return;
    }

    if (isAuthenticated && viewer !== undefined) {
      // Redirect to onboarding if not complete
      if (viewer && !viewer.onboardingComplete && !isOnboarding && !isPublic) {
        router.replace("/onboarding");
        return;
      }
      // Redirect away from onboarding if already complete
      if (viewer && viewer.onboardingComplete && isOnboarding) {
        router.replace("/");
        return;
      }
    }

    // Redirect non-admins away from admin-only paths
    if (isAuthenticated && viewerOrg !== undefined && isAdminPath) {
      if (!viewerOrg || viewerOrg.membership.role !== "admin") {
        router.replace("/");
        return;
      }
    }
  }, [isLoading, isAuthenticated, isPublic, isOnboarding, isAdminPath, viewer, viewerOrg, router, pathname]);

  if (isLoading || (isAuthenticated && viewer === undefined)) {
    if (isPublic) return null;
    return (
      <AppShell>
        <div className="mb-6">
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated && !isPublic) {
    return null;
  }

  // Waiting for redirect to onboarding
  if (isAuthenticated && viewer && !viewer.onboardingComplete && !isOnboarding && !isPublic) {
    return null;
  }

  // Waiting for redirect away from onboarding
  if (isAuthenticated && viewer && viewer.onboardingComplete && isOnboarding) {
    return null;
  }

  // Waiting for redirect away from admin paths
  if (isAdminPath && viewerOrg !== undefined && (!viewerOrg || viewerOrg.membership.role !== "admin")) {
    return null;
  }

  return <>{children}</>;
}
