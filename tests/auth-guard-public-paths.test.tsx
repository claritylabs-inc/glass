// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGuard } from "@/components/auth-guard";

const mocks = vi.hoisted(() => ({
  cacheShellRecord: vi.fn(async () => {}),
  clearOnboardingCache: vi.fn(),
  clearScope: vi.fn(async () => {}),
  pathname: "/oauth/authorize",
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
  usePathname: () => mocks.pathname,
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

async function renderGuard() {
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(
      <AuthGuard>
        <div>OAuth consent</div>
      </AuthGuard>,
    );
  });
  return container;
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  mocks.pathname = "/oauth/authorize";
  vi.clearAllMocks();
});

describe("AuthGuard public paths", () => {
  it("keeps a signed-in operator on the OAuth consent screen", async () => {
    const container = await renderGuard();

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("OAuth consent");
  });

  it("still sends a signed-in operator from a protected page to the portal", async () => {
    mocks.pathname = "/policies";
    const container = await renderGuard();

    expect(mocks.replace).toHaveBeenCalledWith("/operator");
    expect(container.textContent).not.toContain("OAuth consent");
  });
});
