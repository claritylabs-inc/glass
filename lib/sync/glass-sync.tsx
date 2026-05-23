"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dayjs from "dayjs";
import {
  createSyncStore,
  defineCollection,
  stableHash,
  SyncProvider,
  useSyncCollection,
  useSyncStore,
  type SyncRecord,
} from "@claritylabs/cl-sync";

const GLASS_SYNC_SCOPE_KEY = "glass:sync-scope";

type GlassSyncScope = {
  userId?: string;
  orgId?: string;
};

type GlassSyncContextValue = {
  scope: GlassSyncScope;
  updateScope: (scope: GlassSyncScope) => void;
  clearScope: () => Promise<void>;
};

const GlassSyncContext = createContext<GlassSyncContextValue | null>(null);

export type CachedShellRecord = SyncRecord & {
  _id: "current";
  viewer?: unknown;
  viewerOrg?: unknown;
  accountKind?: "customer" | "operator";
  onboardingComplete?: boolean;
  membershipRole?: "admin" | "member";
  updatedAt: number;
};

export const cachedShellCollection = defineCollection<CachedShellRecord>({
  name: "glass.cachedShell",
  persist: true,
});

function readInitialScope(): GlassSyncScope {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(GLASS_SYNC_SCOPE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GlassSyncScope;
    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      orgId: typeof parsed.orgId === "string" ? parsed.orgId : undefined,
    };
  } catch {
    return {};
  }
}

function persistScope(scope: GlassSyncScope) {
  try {
    localStorage.setItem(GLASS_SYNC_SCOPE_KEY, JSON.stringify(scope));
  } catch {}
}

export function GlassSyncProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<GlassSyncScope>(() => readInitialScope());
  const store = useMemo(
    () =>
      createSyncStore({
        scope: {
          appId: "glass",
          environment:
            process.env.NEXT_PUBLIC_VERCEL_ENV ??
            process.env.NODE_ENV ??
            "local",
          userId: scope.userId ?? "anonymous",
          orgId: scope.orgId ?? "none",
        },
      }),
    [scope.orgId, scope.userId],
  );

  const updateScope = useCallback((nextScope: GlassSyncScope) => {
    setScope((previous) => {
      const hasUserId = Object.prototype.hasOwnProperty.call(
        nextScope,
        "userId",
      );
      const hasOrgId = Object.prototype.hasOwnProperty.call(
        nextScope,
        "orgId",
      );
      const merged = {
        userId: hasUserId ? nextScope.userId : previous.userId,
        orgId: hasOrgId ? nextScope.orgId : previous.orgId,
      };
      persistScope(merged);
      return merged;
    });
  }, []);

  const clearScope = useCallback(async () => {
    await store.clearScope();
    try {
      localStorage.removeItem(GLASS_SYNC_SCOPE_KEY);
    } catch {}
    setScope({});
  }, [store]);

  const value = useMemo(
    () => ({ scope, updateScope, clearScope }),
    [clearScope, scope, updateScope],
  );

  return (
    <GlassSyncContext.Provider value={value}>
      <SyncProvider store={store}>{children}</SyncProvider>
    </GlassSyncContext.Provider>
  );
}

export function useGlassSync() {
  const value = useContext(GlassSyncContext);
  if (!value) throw new Error("useGlassSync must be used inside GlassSyncProvider");
  return value;
}

export function useCachedShell() {
  return useSyncCollection(cachedShellCollection, {})?.[0];
}

export function useCacheShellRecord() {
  const store = useSyncStore();
  return useCallback(
    async (record: Omit<CachedShellRecord, "_id" | "updatedAt">) => {
      const existing = store.getCollection(cachedShellCollection, {})?.[0];
      const nextRecordFingerprint = stableHash(record);
      if (
        existing &&
        stableHash({
          viewer: existing.viewer,
          viewerOrg: existing.viewerOrg,
          accountKind: existing.accountKind,
          onboardingComplete: existing.onboardingComplete,
          membershipRole: existing.membershipRole,
        }) === nextRecordFingerprint
      ) {
        return;
      }
      await store.upsertCollection(cachedShellCollection, {}, [{
        _id: "current",
        ...record,
        updatedAt: dayjs().valueOf(),
      }]);
    },
    [store],
  );
}
