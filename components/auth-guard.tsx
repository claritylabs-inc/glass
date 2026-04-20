"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { Loader2 } from "lucide-react";

const PUBLIC_PATHS = ["/login", "/signup", "/oauth/authorize", "/weather"];
const ONBOARDING_PATH = "/onboarding";
const ADMIN_PATHS = ["/settings"];

/**
 * Loading state shown when we know the user needs onboarding.
 * Matches the onboarding page Shell layout for visual consistency.
 */
function OnboardingLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="w-full px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-muted-foreground">
          <div className="justify-self-start min-w-0">
            <div className="h-5 w-24 bg-foreground/10 rounded animate-pulse" />
          </div>
          <div className="justify-self-center flex items-center gap-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-foreground/10 animate-pulse"
              />
            ))}
          </div>
          <div className="justify-self-end min-w-0">
            <div className="h-4 w-32 bg-foreground/10 rounded animate-pulse" />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    </div>
  );
}

/**
 * Loading state shown when we know the user is onboarded.
 * Shows the dashboard AppShell with skeleton content.
 */
function DashboardLoading() {
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

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { onboardingComplete: cachedOnboarding, setOnboardingComplete } = useOnboardingCache();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);
  const isOnboarding = pathname === ONBOARDING_PATH;
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));

  // Only query viewer when authenticated
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const viewerOrg = useQuery(api.orgs.viewerOrg, isAuthenticated ? {} : "skip");

  // Update cached onboarding state when we learn it from the server
  useEffect(() => {
    if (viewer !== undefined && viewer !== null) {
      setOnboardingComplete(!!viewer.onboardingComplete);
    }
  }, [viewer, setOnboardingComplete]);

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

  // Loading state - use cached onboarding preference to show appropriate skeleton
  if (isLoading || (isAuthenticated && viewer === undefined)) {
    if (isPublic) return null;

    // If we know from cache that onboarding is NOT complete, show onboarding loading
    // This prevents the flash of dashboard for new users
    if (cachedOnboarding === false) {
      return <OnboardingLoading />;
    }

    // Default to dashboard loading for:
    // - cachedOnboarding === true (user is onboarded)
    // - cachedOnboarding === null (unknown, first visit - assume onboarded for safety)
    return <DashboardLoading />;
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
