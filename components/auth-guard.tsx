"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

const PUBLIC_PATHS = ["/login", "/signup", "/auth/callback", "/auth/bootstrap", "/logout", "/oauth/authorize", "/weather"];
const ONBOARDING_PATH = "/onboarding";
const ADMIN_PATHS = ["/settings"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isOnboarding = pathname === ONBOARDING_PATH;
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));

  const viewer = useQuery(api.users.viewer, user ? {} : "skip");
  const viewerOrg = useQuery(api.orgs.viewerOrg, user ? {} : "skip");

  useEffect(() => {
    if (loading) return;

    if (!user && !isPublic) {
      router.replace("/login");
      return;
    }

    if (user && viewer !== undefined) {
      if (viewer && !viewer.onboardingComplete && !isOnboarding && !isPublic) {
        router.replace("/onboarding");
        return;
      }
      if (viewer && viewer.onboardingComplete && isOnboarding) {
        router.replace("/");
        return;
      }
    }

    if (user && viewerOrg !== undefined && isAdminPath) {
      if (!viewerOrg || viewerOrg.membership.role !== "admin") {
        router.replace("/");
        return;
      }
    }
  }, [loading, user, isPublic, isOnboarding, isAdminPath, viewer, viewerOrg, router, pathname]);

  if (loading || (user && viewer === undefined)) {
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

  if (!user && !isPublic) {
    return null;
  }

  if (user && viewer && !viewer.onboardingComplete && !isOnboarding && !isPublic) {
    return null;
  }

  if (user && viewer && viewer.onboardingComplete && isOnboarding) {
    return null;
  }

  if (isAdminPath && viewerOrg !== undefined && (!viewerOrg || viewerOrg.membership.role !== "admin")) {
    return null;
  }

  return <>{children}</>;
}
