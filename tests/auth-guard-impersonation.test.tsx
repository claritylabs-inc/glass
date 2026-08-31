// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGuard } from "@/components/auth-guard";
import {
  beginOperatorImpersonationStop,
  endOperatorImpersonationStop,
} from "@/lib/operator-impersonation-stop-state";

const mocks = vi.hoisted(() => ({
  cacheShellRecord: vi.fn(async () => {}),
  clearOnboardingCache: vi.fn(),
  clearScope: vi.fn(async () => {}),
  replace: vi.fn(),
  setOnboardingComplete: vi.fn(),
  updateScope: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/policies",
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    operator: { current: "operator.current" },
    orgs: {
      acceptInvitation: "orgs.acceptInvitation",
      pendingInvitationForViewer: "orgs.pendingInvitationForViewer",
      viewerOrg: "orgs.viewerOrg",
    },
    users: { viewer: "users.viewer" },
  },
}));

vi.mock("@/lib/sync/use-cached-query", () => ({
  useCachedQuery: (cacheName: string) => {
    if (cacheName === "authGuard.viewer") {
      return {
        _id: "operator-1",
        accountKind: "operator",
        onboardingComplete: true,
      };
    }
    if (cacheName === "authGuard.viewerOrg") return null;
    if (cacheName === "authGuard.operator.current") {
      return {
        user: { email: "operator@example.com" },
        activeImpersonation: null,
      };
    }
    return undefined;
  },
}));

vi.mock("@/lib/sync/spot-sync", () => ({
  useCachedShell: () => undefined,
  useCacheShellRecord: () => mocks.cacheShellRecord,
  useSpotSync: () => ({
    scope: { userId: "operator-1", orgId: undefined },
    updateScope: mocks.updateScope,
    clearScope: mocks.clearScope,
  }),
}));

vi.mock("@/hooks/use-onboarding-cache", () => ({
  useOnboardingCache: () => ({
    onboardingComplete: true,
    setOnboardingComplete: mocks.setOnboardingComplete,
    clearCache: mocks.clearOnboardingCache,
  }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("@/app/operator/operator-sidebar", () => ({
  OperatorSidebar: () => null,
}));

let mountedRoot: Root | null = null;

afterEach(async () => {
  endOperatorImpersonationStop();
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("AuthGuard operator impersonation teardown", () => {
  it("preserves the client detail return route after the session ends", async () => {
    beginOperatorImpersonationStop("/operator/clients/client-123");
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <AuthGuard>
          <div>Policy workspace</div>
        </AuthGuard>,
      );
    });

    expect(mocks.replace).toHaveBeenCalledWith(
      "/operator/clients/client-123",
    );
    expect(mocks.replace).not.toHaveBeenCalledWith("/operator");
  });
});
