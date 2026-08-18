"use node";

import dayjs from "dayjs";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;
const RECONCILIATION_CONCURRENCY = 5;

type ChannelResult = {
  id: string;
  ok: boolean;
  name?: string;
  isArchived?: boolean;
  isMember?: boolean;
  isPrivate?: boolean;
  isShared?: boolean;
  isExtShared?: boolean;
  isOrgShared?: boolean;
  errorCode?: string;
  retryable?: boolean;
};

type ReconciliationResult = {
  teamId?: string;
  botUserId?: string;
  channels?: ChannelResult[];
  error?: string;
  providerErrorCode?: string;
  retryable?: boolean;
};

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function probe(teamId: string, channelIds: string[]) {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/reconcile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ teamId, channelIds }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response
    .json()
    .catch(() => ({}))) as ReconciliationResult;
  return {
    ok: response.ok,
    botUserId: result.botUserId,
    channels: result.channels ?? [],
    errorCode: result.providerErrorCode,
    errorSummary: result.error,
    retryable: result.retryable ?? !response.ok,
  };
}

export const runDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const checkedAt = dayjs().valueOf();
    const contexts = await ctx.runQuery(
      internalApi.slackLifecycle.listDueReconciliationContexts,
      { now: checkedAt, limit: 25 },
    );
    const reconcile = async ({
      connection,
      binding,
    }: (typeof contexts)[number]) => {
      const customerChannelIds = Array.from(
        new Set(
          [binding?.customerChannelId, connection.automaticChannelId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      );
      const customerPromise = probe(
        connection.teamId,
        customerChannelIds,
      ).catch((error) => ({
        ok: false,
        channels: [] as ChannelResult[],
        errorSummary: error instanceof Error ? error.message : String(error),
        retryable: true,
      }));
      const hostPromise = binding
        ? probe(binding.hostTeamId, [binding.hostChannelId]).catch((error) => ({
            ok: false,
            channels: [] as ChannelResult[],
            errorSummary:
              error instanceof Error ? error.message : String(error),
            retryable: true,
          }))
        : Promise.resolve(null);
      const [customer, host] = await Promise.all([
        customerPromise,
        hostPromise,
      ]);
      await ctx.runMutation(
        internalApi.slackLifecycle.applyReconciliationResult,
        {
          connectionId: connection._id,
          expectedAuthorizationUpdatedAt: connection.authorizationUpdatedAt,
          expectedBindingId: binding?._id,
          expectedBindingBoundAt: binding?.boundAt,
          side: "customer",
          teamId: connection.teamId,
          checkedAt,
          ...customer,
        },
      );

      if (!binding || !host) return 1;
      await ctx.runMutation(
        internalApi.slackLifecycle.applyReconciliationResult,
        {
          connectionId: connection._id,
          expectedAuthorizationUpdatedAt: connection.authorizationUpdatedAt,
          expectedBindingId: binding._id,
          expectedBindingBoundAt: binding.boundAt,
          side: "host",
          teamId: binding.hostTeamId,
          checkedAt,
          ...host,
        },
      );
      return 2;
    };

    let checked = 0;
    for (
      let offset = 0;
      offset < contexts.length;
      offset += RECONCILIATION_CONCURRENCY
    ) {
      const batch = contexts.slice(offset, offset + RECONCILIATION_CONCURRENCY);
      const counts = await Promise.all(batch.map(reconcile));
      checked += counts.reduce((total, count) => total + count, 0);
    }
    return { connections: contexts.length, checks: checked, checkedAt };
  },
});
