"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  defineMutation,
  stableHash,
  useSyncStore,
  type SyncStore,
} from "@claritylabs/cl-sync";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";

type LocalFirstAutoSaveOptions<TArgs, TResult> = {
  mutationName: string;
  args: TArgs;
  valueKey?: string;
  resetKey?: string;
  enabled?: boolean;
  canSave?: boolean;
  delayMs?: number;
  autoSave?: boolean;
  applyLocal?: (
    store: SyncStore,
    args: TArgs,
    clientMutationId: string,
  ) => void;
  flush: (args: TArgs, clientMutationId: string) => Promise<TResult>;
  onFlushed?: (result: TResult | undefined, args: TArgs) => void;
  onError?: (error: unknown, args: TArgs) => void;
  errorMessage?: string | ((error: unknown, args: TArgs) => string);
};

export type AutoSaveStatus = "saved" | "saving" | "unsaved" | "error";

export function useLocalFirstAutoSave<TArgs, TResult = unknown>({
  mutationName,
  args,
  valueKey = stableHash(args),
  resetKey = mutationName,
  enabled = true,
  canSave = true,
  delayMs = 600,
  autoSave = true,
  applyLocal,
  flush,
  onFlushed,
  onError,
  errorMessage = "Check your connection and try again.",
}: LocalFirstAutoSaveOptions<TArgs, TResult>) {
  const store = useSyncStore();
  const [saving, setSaving] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [lastSavedKey, setLastSavedKey] = useState(valueKey);
  const [settledResetKey, setSettledResetKey] = useState(resetKey);
  const [enabledBaselineKey, setEnabledBaselineKey] = useState<string | null>(
    enabled ? valueKey : null,
  );
  const lastSavedKeyRef = useRef(valueKey);
  const wasEnabledRef = useRef(enabled);
  const lastResetKeyRef = useRef(resetKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSavesRef = useRef(new Map<string, Promise<boolean>>());
  const latestSaveSequenceRef = useRef(0);
  const argsRef = useRef(args);
  const valueKeyRef = useRef(valueKey);
  const enabledRef = useRef(enabled);
  const canSaveRef = useRef(canSave);
  const applyLocalRef = useRef(applyLocal);
  const flushRef = useRef(flush);
  const onFlushedRef = useRef(onFlushed);
  const onErrorRef = useRef(onError);
  const errorMessageRef = useRef(errorMessage);
  /* eslint-disable react-hooks/refs */
  const mutation = useMemo(
    () =>
      defineMutation<TArgs, TResult>({
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
    onFlushedRef.current = onFlushed;
    onErrorRef.current = onError;
    errorMessageRef.current = errorMessage;
  }, [
    applyLocal,
    args,
    canSave,
    enabled,
    errorMessage,
    flush,
    onError,
    onFlushed,
    valueKey,
  ]);

  useEffect(() => {
    const unregister = store.registerMutation(mutation);
    void store.flushPendingMutations({
      predicate: (item) => item.mutation === mutation.name,
    });
    return unregister;
  }, [mutation, store]);

  useEffect(() => {
    if (resetKey === lastResetKeyRef.current) return;
    lastResetKeyRef.current = resetKey;
    lastSavedKeyRef.current = valueKey;
    latestSaveSequenceRef.current += 1;
    wasEnabledRef.current = enabled;
    if (timerRef.current) clearTimeout(timerRef.current);
    setLastSavedKey(valueKey);
    setSettledResetKey(resetKey);
    setEnabledBaselineKey(enabled ? valueKey : null);
    setFailedKey(null);
  }, [enabled, resetKey, valueKey]);

  const queueSave = useCallback(
    (options?: { force?: boolean }): Promise<boolean> => {
      const valueKey = valueKeyRef.current;
      const pendingSave = pendingSavesRef.current.get(valueKey);
      if (pendingSave) return pendingSave;
      if (!enabledRef.current || !canSaveRef.current) {
        return Promise.resolve(false);
      }
      if (!options?.force && valueKey === lastSavedKeyRef.current) {
        return Promise.resolve(true);
      }
      if (timerRef.current) clearTimeout(timerRef.current);

      const queuedKey = valueKey;
      const queuedArgs = argsRef.current;
      const saveSequence = latestSaveSequenceRef.current + 1;
      latestSaveSequenceRef.current = saveSequence;
      const clientMutationId = createClientMutationId(mutationName);
      setSaving(true);
      setFailedKey((current) => (current === queuedKey ? null : current));

      const result = store.enqueueMutation(
        mutation,
        queuedArgs,
        clientMutationId,
      );

      const promise = result
        .then((flushResult) => {
          if (saveSequence === latestSaveSequenceRef.current) {
            lastSavedKeyRef.current = queuedKey;
            setLastSavedKey(queuedKey);
          }
          setFailedKey((current) => (current === queuedKey ? null : current));
          onFlushedRef.current?.(flushResult, queuedArgs);
          return true;
        })
        .catch((error) => {
          setFailedKey(queuedKey);
          onErrorRef.current?.(error, queuedArgs);
          const detail =
            typeof errorMessageRef.current === "function"
              ? errorMessageRef.current(error, queuedArgs)
              : errorMessageRef.current;
          toast.error("Changes weren’t saved", {
            id: `auto-save:${mutationName}`,
            description: detail,
          });
          return false;
        })
        .finally(() => {
          pendingSavesRef.current.delete(queuedKey);
          const hasPendingSaves = pendingSavesRef.current.size > 0;
          setSaving(hasPendingSaves);
        });

      pendingSavesRef.current.set(queuedKey, promise);
      return promise;
    },
    [mutation, mutationName, store],
  );

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-enabling must adopt the hydrated value instead of saving it
      setEnabledBaselineKey(null);
      return;
    }

    if (!wasEnabledRef.current) {
      lastSavedKeyRef.current = valueKey;
      latestSaveSequenceRef.current += 1;
      wasEnabledRef.current = true;
      setLastSavedKey(valueKey);
      setEnabledBaselineKey(valueKey);
      setFailedKey(null);
      return;
    }

    if (valueKey === lastSavedKeyRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (!canSave || !autoSave) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void queueSave();
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoSave, canSave, delayMs, enabled, queueSave, valueKey]);

  const resetting = resetKey !== settledResetKey;
  const resuming = enabled && enabledBaselineKey === null;
  const dirty =
    enabled && !resetting && !resuming && valueKey !== lastSavedKey;
  const status: AutoSaveStatus = !dirty
    ? "saved"
    : failedKey === valueKey
      ? "error"
      : saving || (autoSave && canSave)
        ? "saving"
        : "unsaved";

  return { saving, status, saveNow: queueSave };
}
