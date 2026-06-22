"use client";

import { useCallback } from "react";
import dayjs from "dayjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

type OperatorCurrent = FunctionReturnType<typeof api.operator.current>;
type OperatorBrokerList = FunctionReturnType<typeof api.operator.listBrokers>;
type OperatorBrokerRow = OperatorBrokerList[number];
type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;
type OperatorClientRow = OperatorClientList[number];
type OperatorMGAList = FunctionReturnType<typeof api.operator.listMGAs>;
type OperatorMGARow = OperatorMGAList[number];
type OperatorGlobalModelSettings = FunctionReturnType<
  typeof api.modelSettings.getGlobal
>;
type OperatorExtractionTraceList = FunctionReturnType<
  typeof api.operator.listExtractionTraces
>;
type OperatorExtractionTraceDetail = FunctionReturnType<
  typeof api.operator.getExtractionTrace
>;
type OperatorDemoSalesTranscriptList = FunctionReturnType<
  typeof api.operator.listPublicDemoSalesTranscripts
>;
type OperatorDemoSalesTranscriptDetail = FunctionReturnType<
  typeof api.operator.getPublicDemoSalesTranscript
>;
type GlobalRoutes = OperatorGlobalModelSettings["routes"];
type GlobalWebRetrieval = OperatorGlobalModelSettings["webRetrieval"];
type EmptyArgs = Record<string, never>;
type OperatorStatus = "onboarding" | "live";
type TraceStatus = "running" | "complete" | "error" | "cancelled";
type ExtractionRangeKey = "all" | "24h" | "30d" | "90d";
type ExtractionTraceListArgs = {
  status?: TraceStatus;
  orgId?: Id<"organizations">;
  dateFrom?: number;
  limit?: number;
};
type ExtractionTraceFilters = {
  status?: TraceStatus;
  orgId?: string;
  range: ExtractionRangeKey;
  limit?: number;
};
type DemoSalesTranscriptListArgs = {
  limit?: number;
};
type GlobalRoute = GlobalRoutes[keyof GlobalRoutes];
type OptimisticBrokerInput = {
  brokerOrgId: Id<"organizations">;
  name: string;
  slug?: string;
  website?: string;
  agentHandle?: string;
  adminEmail?: string;
  adminName?: string;
  adminPhone?: string;
};
type OptimisticClientInput = {
  clientOrgId: Id<"organizations">;
  name: string;
  brokerOrgId?: Id<"organizations">;
  brokerName?: string;
  website?: string;
  agentHandle?: string;
  adminEmail?: string;
  adminName?: string;
  adminPhone?: string;
};
type OptimisticMGAInput = {
  mgaOrgId: Id<"organizations">;
  name: string;
  website?: string;
  programName?: string;
  adminEmail?: string;
  adminName?: string;
};

const extractionRangeMs: Record<Exclude<ExtractionRangeKey, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

function sortByCreatedAtDesc<T extends { createdAt: number }>(rows: T[]) {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

export function stableExtractionDateFrom(range: ExtractionRangeKey) {
  if (range === "all") return undefined;
  return dayjs().startOf("hour").valueOf() - extractionRangeMs[range];
}

export function operatorExtractionTraceListArgs(
  filters: ExtractionTraceFilters,
): ExtractionTraceListArgs {
  return {
    status: filters.status,
    orgId: filters.orgId
      ? (filters.orgId as Id<"organizations">)
      : undefined,
    dateFrom: stableExtractionDateFrom(filters.range),
    limit: filters.limit ?? 250,
  };
}

export function operatorDemoSalesTranscriptListArgs(
  limit = 250,
): DemoSalesTranscriptListArgs {
  return { limit };
}

export function useCachedOperatorCurrent() {
  return useCachedQuery(
    "operator.current",
    api.operator.current,
    {},
  ) as OperatorCurrent | undefined;
}

export function useCachedOperatorBrokers(search?: string) {
  return useCachedQuery(
    "operator.listBrokers",
    api.operator.listBrokers,
    search ? { search } : {},
  ) as OperatorBrokerList | undefined;
}

export function useCachedOperatorClients() {
  return useCachedQuery(
    "operator.listClients",
    api.operator.listClients,
    {},
  ) as OperatorClientList | undefined;
}

export function useCachedOperatorMGAs() {
  return useCachedQuery(
    "operator.listMGAs",
    api.operator.listMGAs,
    {},
  ) as OperatorMGAList | undefined;
}

export function useCachedOperatorGlobalModelSettings() {
  return useCachedQuery(
    "operator.modelSettings.getGlobal",
    api.modelSettings.getGlobal,
    {},
  ) as OperatorGlobalModelSettings | undefined;
}

export function useCachedOperatorExtractionTraces(
  filters: ExtractionTraceFilters,
) {
  return useCachedQuery(
    "operator.listExtractionTraces",
    api.operator.listExtractionTraces,
    operatorExtractionTraceListArgs(filters),
  ) as OperatorExtractionTraceList | undefined;
}

export function useCachedOperatorExtractionTraceDetail(
  traceId: string | null,
) {
  return useCachedQuery(
    "operator.getExtractionTrace.v3",
    api.operator.getExtractionTrace,
    traceId ? { traceId } : "skip",
  ) as OperatorExtractionTraceDetail | undefined;
}

export function useCachedOperatorDemoSalesTranscripts(
  limit = 250,
) {
  return useCachedQuery(
    "operator.listPublicDemoSalesTranscripts",
    api.operator.listPublicDemoSalesTranscripts,
    operatorDemoSalesTranscriptListArgs(limit),
  ) as OperatorDemoSalesTranscriptList | undefined;
}

export function useCachedOperatorDemoSalesTranscriptDetail(
  transcriptId: string | null,
) {
  return useCachedQuery(
    "operator.getPublicDemoSalesTranscript",
    api.operator.getPublicDemoSalesTranscript,
    transcriptId ? { id: transcriptId as Id<"publicDemoSalesTranscripts"> } : "skip",
  ) as OperatorDemoSalesTranscriptDetail | undefined;
}

export function useOperatorBrokerCacheActions() {
  const upsertBrokers = useUpsertCachedQuery<OperatorBrokerList, { search?: string }>(
    "operator.listBrokers",
  );
  const updateBrokers = useUpdateCachedQuery<OperatorBrokerList, { search?: string }>(
    "operator.listBrokers",
  );

  const seedBroker = useCallback(
    async (input: OptimisticBrokerInput) => {
      const now = dayjs().valueOf();
      const row = {
        _id: input.brokerOrgId,
        name: input.name,
        slug: input.slug,
        website: input.website,
        iconStorageId: undefined,
        iconUrl: null,
        agentHandle: input.agentHandle,
        operatorStatus: "onboarding",
        onboardingComplete: true,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        clientCount: 0,
        createdAt: now,
      } satisfies OperatorBrokerRow;
      await upsertBrokers({}, (current) =>
        sortByCreatedAtDesc([
          row,
          ...(current ?? []).filter((broker) => broker._id !== row._id),
        ]),
      );
    },
    [upsertBrokers],
  );

  const patchBrokerStatus = useCallback(
    async (brokerOrgId: Id<"organizations">, status: OperatorStatus) => {
      await updateBrokers({}, (current) =>
        current.map((broker) =>
          broker._id === brokerOrgId
            ? { ...broker, operatorStatus: status }
            : broker,
        ),
      );
    },
    [updateBrokers],
  );

  const patchBrokerSettings = useCallback(
    async (
      brokerOrgId: Id<"organizations">,
      patch: Partial<
        Pick<
          OperatorBrokerRow,
          | "slug"
          | "website"
          | "agentHandle"
          | "adminName"
          | "adminPhone"
        >
      >,
    ) => {
      await updateBrokers({}, (current) =>
        current.map((broker) =>
          broker._id === brokerOrgId ? { ...broker, ...patch } : broker,
        ),
      );
    },
    [updateBrokers],
  );

  return { seedBroker, patchBrokerStatus, patchBrokerSettings };
}

export function useOperatorClientCacheActions() {
  const upsertClients = useUpsertCachedQuery<OperatorClientList, EmptyArgs>(
    "operator.listClients",
  );
  const updateClients = useUpdateCachedQuery<OperatorClientList, EmptyArgs>(
    "operator.listClients",
  );

  const seedClient = useCallback(
    async (input: OptimisticClientInput) => {
      const now = dayjs().valueOf();
      const row = {
        _id: input.clientOrgId,
        name: input.name,
        website: input.website,
        iconStorageId: undefined,
        iconUrl: null,
        agentHandle: input.agentHandle,
        operatorStatus: "onboarding",
        onboardingComplete: true,
        inviteStatus: "draft",
        primaryContactName: input.adminName,
        primaryContactEmail: input.adminEmail,
        primaryContactPhone: input.adminPhone,
        adminUserId: undefined,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        brokerOrgId: input.brokerOrgId,
        brokerName: input.brokerName,
        createdAt: now,
      } satisfies OperatorClientRow;
      await upsertClients({}, (current) =>
        sortByCreatedAtDesc([
          row,
          ...(current ?? []).filter((client) => client._id !== row._id),
        ]),
      );
    },
    [upsertClients],
  );

  const patchClientStatus = useCallback(
    async (clientOrgId: Id<"organizations">, status: OperatorStatus) => {
      await updateClients({}, (current) =>
        current.map((client) =>
          client._id === clientOrgId
            ? { ...client, operatorStatus: status }
            : client,
        ),
      );
    },
    [updateClients],
  );

  const patchClientSettings = useCallback(
    async (
      clientOrgId: Id<"organizations">,
      patch: Partial<
        Pick<
          OperatorClientRow,
          | "brokerOrgId"
          | "brokerName"
          | "website"
          | "agentHandle"
          | "primaryContactName"
          | "primaryContactEmail"
          | "primaryContactPhone"
          | "adminName"
          | "adminPhone"
        >
      >,
    ) => {
      await updateClients({}, (current) =>
        current.map((client) =>
          client._id === clientOrgId ? { ...client, ...patch } : client,
        ),
      );
    },
    [updateClients],
  );

  return { seedClient, patchClientStatus, patchClientSettings };
}

export function useOperatorMGACacheActions() {
  const upsertMGAs = useUpsertCachedQuery<OperatorMGAList, EmptyArgs>(
    "operator.listMGAs",
  );
  const updateMGAs = useUpdateCachedQuery<OperatorMGAList, EmptyArgs>(
    "operator.listMGAs",
  );

  const seedMGA = useCallback(
    async (input: OptimisticMGAInput) => {
      const now = dayjs().valueOf();
      const row = {
        _id: input.mgaOrgId,
        name: input.name,
        website: input.website,
        iconStorageId: undefined,
        iconUrl: null,
        programName: input.programName,
        operatorStatus: "onboarding",
        onboardingComplete: true,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        createdAt: now,
      } satisfies OperatorMGARow;
      await upsertMGAs({}, (current) =>
        sortByCreatedAtDesc([
          row,
          ...(current ?? []).filter((mga) => mga._id !== row._id),
        ]),
      );
    },
    [upsertMGAs],
  );

  const patchMGAStatus = useCallback(
    async (mgaOrgId: Id<"organizations">, status: OperatorStatus) => {
      await updateMGAs({}, (current) =>
        current.map((mga) =>
          mga._id === mgaOrgId ? { ...mga, operatorStatus: status } : mga,
        ),
      );
    },
    [updateMGAs],
  );

  return { seedMGA, patchMGAStatus };
}

export function useOperatorGlobalModelSettingsCacheActions() {
  const updateSettings = useUpdateCachedQuery<OperatorGlobalModelSettings, EmptyArgs>(
    "operator.modelSettings.getGlobal",
  );

  const patchRoute = useCallback(
    async (taskId: string, route: GlobalRoute) => {
      await updateSettings({}, (current) => ({
        ...current,
        routes: {
          ...current.routes,
          [taskId]: route,
        },
        updatedAt: dayjs().valueOf(),
      }));
    },
    [updateSettings],
  );

  const patchWebRetrieval = useCallback(
    async (webRetrieval: GlobalWebRetrieval) => {
      await updateSettings({}, (current) => ({
        ...current,
        webRetrieval,
        updatedAt: dayjs().valueOf(),
      }));
    },
    [updateSettings],
  );

  return { patchRoute, patchWebRetrieval };
}
