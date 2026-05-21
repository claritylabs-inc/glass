"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  defineMutation,
  stableHash,
  useSyncStore,
  type SyncStore,
} from "@claritylabs/cl-sync";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";

type LocalFirstAutoSaveOptions<TArgs> = {
  mutationName: string;
  args: TArgs;
  valueKey?: string;
  enabled?: boolean;
  canSave?: boolean;
  delayMs?: number;
  applyLocal?: (
    store: SyncStore,
    args: TArgs,
    clientMutationId: string,
  ) => void;
  flush: (args: TArgs, clientMutationId: string) => Promise<unknown>;
  onQueued?: () => void;
  onFlushed?: () => void;
  onError?: (error: unknown) => void;
};

export function useLocalFirstAutoSave<TArgs>({
  mutationName,
  args,
  valueKey = stableHash(args),
  enabled = true,
  canSave = true,
  delayMs = 600,
  applyLocal,
  flush,
  onQueued,
  onFlushed,
  onError,
}: LocalFirstAutoSaveOptions<TArgs>) {
  const store = useSyncStore();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastQueuedKeyRef = useRef(valueKey);
  const wasEnabledRef = useRef(enabled);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const argsRef = useRef(args);
  const valueKeyRef = useRef(valueKey);
  const enabledRef = useRef(enabled);
  const canSaveRef = useRef(canSave);
  const applyLocalRef = useRef(applyLocal);
  const flushRef = useRef(flush);
  const onQueuedRef = useRef(onQueued);
  const onFlushedRef = useRef(onFlushed);
  const onErrorRef = useRef(onError);
  /* eslint-disable react-hooks/refs */
  const mutation = useMemo(
    () =>
      defineMutation<TArgs, unknown>({
        name: mutationName,
        reducer: (syncStore, mutationArgs, clientMutationId) => {
          applyLocalRef.current?.(syncStore, mutationArgs, clientMutationId);
        },
        flush: (mutationArgs, clientMutationId) =>
          flushRef.current(mutationArgs, clientMutationId),
      }),
    [mutationName],
  );
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    argsRef.current = args;
    valueKeyRef.current = valueKey;
    enabledRef.current = enabled;
    canSaveRef.current = canSave;
    applyLocalRef.current = applyLocal;
    flushRef.current = flush;
    onQueuedRef.current = onQueued;
    onFlushedRef.current = onFlushed;
    onErrorRef.current = onError;
  }, [
    applyLocal,
    args,
    canSave,
    enabled,
    flush,
    onError,
    onFlushed,
    onQueued,
    valueKey,
  ]);

  useEffect(() => {
    const unregister = store.registerMutation(mutation);
    void store.flushPendingMutations({
      predicate: (item) => item.mutation === mutation.name,
    });
    return unregister;
  }, [mutation, store]);

  const queueSave = useCallback(() => {
    if (!enabledRef.current || !canSaveRef.current) return;
    if (valueKeyRef.current === lastQueuedKeyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const queuedKey = valueKeyRef.current;
    const clientMutationId = createClientMutationId(mutationName);
    setSaving(true);

    const result = store.enqueueMutation(
      mutation,
      argsRef.current,
      clientMutationId,
    );

    lastQueuedKeyRef.current = queuedKey;
    setSavedAt(dayjs().valueOf());
    setSaving(false);
    onQueuedRef.current?.();

    void result
      ?.then(() => {
        onFlushedRef.current?.();
      })
      .catch((error) => {
        onErrorRef.current?.(error);
      });
  }, [mutation, mutationName, store]);

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      return;
    }

    if (!wasEnabledRef.current) {
      lastQueuedKeyRef.current = valueKey;
      wasEnabledRef.current = true;
      return;
    }

    if (!canSave || valueKey === lastQueuedKeyRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(queueSave, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [canSave, delayMs, enabled, queueSave, valueKey]);

  return { saving, savedAt, saveNow: queueSave };
}
