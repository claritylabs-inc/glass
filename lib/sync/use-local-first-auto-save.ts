"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { stableHash, useSyncStore, type SyncStore } from "@claritylabs/cl-sync";
import {
  createAutoSaveSequencer,
  isCurrentAutoSaveRequest,
  isDivergentAutoSaveRequest,
  type AutoSaveRequestIdentity,
  type AutoSaveRequestState,
} from "@/lib/sync/auto-save-sequencer";
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

type PendingAutoSaveRequest = AutoSaveRequestIdentity & {
  promise: Promise<boolean>;
  completion: Promise<boolean>;
};

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
  const [sequencer] = useState(createAutoSaveSequencer);
  const [resetGeneration, setResetGeneration] = useState(0);
  const [failedSave, setFailedSave] =
    useState<AutoSaveRequestIdentity | null>(null);
  const [latestRequests, setLatestRequests] = useState(
    () => new Map<string, AutoSaveRequestState>(),
  );
  const [lastSavedKey, setLastSavedKey] = useState(valueKey);
  const [settledResetKey, setSettledResetKey] = useState(resetKey);
  const [enabledBaselineKey, setEnabledBaselineKey] = useState<string | null>(
    enabled ? valueKey : null,
  );
  const lastSavedKeyRef = useRef(valueKey);
  const wasEnabledRef = useRef(enabled);
  const lastResetKeyRef = useRef(resetKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSavesRef = useRef(
    new Map<string, PendingAutoSaveRequest>(),
  );
  const latestRequestsRef = useRef(new Map<string, AutoSaveRequestState>());
  const resetGenerationRef = useRef(0);
  const nextRequestIdRef = useRef(0);
  const intentRevisionRef = useRef(0);
  const lastIntentRef = useRef({ resetKey, valueKey });
  const argsRef = useRef(args);
  const valueKeyRef = useRef(valueKey);
  const resetKeyRef = useRef(resetKey);
  const enabledRef = useRef(enabled);
  const canSaveRef = useRef(canSave);
  const applyLocalRef = useRef(applyLocal);
  const flushRef = useRef(flush);
  const onFlushedRef = useRef(onFlushed);
  const onErrorRef = useRef(onError);
  const errorMessageRef = useRef(errorMessage);
  useLayoutEffect(() => {
    const previousIntent = lastIntentRef.current;
    if (
      previousIntent.resetKey === resetKey &&
      previousIntent.valueKey !== valueKey
    ) {
      intentRevisionRef.current += 1;
    }
    lastIntentRef.current = { resetKey, valueKey };
    argsRef.current = args;
    valueKeyRef.current = valueKey;
    resetKeyRef.current = resetKey;
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
    resetKey,
    valueKey,
  ]);

  useLayoutEffect(() => {
    if (resetKey === lastResetKeyRef.current) return;
    lastResetKeyRef.current = resetKey;
    const nextGeneration = resetGenerationRef.current + 1;
    resetGenerationRef.current = nextGeneration;
    lastSavedKeyRef.current = valueKey;
    wasEnabledRef.current = enabled;
    if (timerRef.current) clearTimeout(timerRef.current);
    setLastSavedKey(valueKey);
    setResetGeneration(nextGeneration);
    setSettledResetKey(resetKey);
    setEnabledBaselineKey(enabled ? valueKey : null);
    setFailedSave(null);
  }, [enabled, resetKey, valueKey]);

  const queueSave = useCallback(
    (options?: { force?: boolean }): Promise<boolean> => {
      const valueKey = valueKeyRef.current;
      const resetKey = resetKeyRef.current;
      const generation = resetGenerationRef.current;
      const current = { generation, resetKey, valueKey };
      const latestRequest = latestRequestsRef.current.get(resetKey) ?? null;
      const pendingSave = pendingSavesRef.current.get(resetKey);
      if (
        pendingSave &&
        isCurrentAutoSaveRequest(pendingSave, latestRequest, current)
      ) {
        return pendingSave.promise;
      }
      if (!enabledRef.current || !canSaveRef.current) {
        return Promise.resolve(false);
      }
      const divergentWritePending = isDivergentAutoSaveRequest(
        latestRequest,
        current,
      );
      if (
        !options?.force &&
        valueKey === lastSavedKeyRef.current &&
        !divergentWritePending
      ) {
        if (
          latestRequest !== null &&
          !latestRequest.settled &&
          latestRequest.generation !== generation &&
          pendingSave?.requestId === latestRequest.requestId
        ) {
          const barrierRequestId = latestRequest.requestId;
          const barrierIntentRevision = intentRevisionRef.current;
          return pendingSave.completion.then(
            (succeeded) =>
              succeeded &&
              resetGenerationRef.current === generation &&
              resetKeyRef.current === resetKey &&
              valueKeyRef.current === valueKey &&
              intentRevisionRef.current === barrierIntentRevision &&
              latestRequestsRef.current.get(resetKey)?.requestId ===
                barrierRequestId,
          );
        }
        return Promise.resolve(true);
      }
      if (timerRef.current) clearTimeout(timerRef.current);

      const queuedKey = valueKey;
      const queuedResetKey = resetKey;
      const queuedArgs = argsRef.current;
      const requestId = nextRequestIdRef.current + 1;
      nextRequestIdRef.current = requestId;
      const clientMutationId = createClientMutationId(mutationName);
      setFailedSave(null);
      const request = {
        generation,
        requestId,
        resetKey: queuedResetKey,
        valueKey: queuedKey,
      };
      const dispatchedSave = {
        ...request,
        settled: false,
      };
      latestRequestsRef.current.set(queuedResetKey, dispatchedSave);
      setLatestRequests((current) =>
        new Map(current).set(queuedResetKey, dispatchedSave),
      );

      const queuedApplyLocal = applyLocalRef.current;
      const queuedFlush = flushRef.current;
      const result = Promise.resolve().then(() => {
        return sequencer.run(() =>
          queuedFlush(queuedArgs, clientMutationId),
        );
      });
      const isRequestCurrent = () =>
        enabledRef.current &&
        isCurrentAutoSaveRequest(
          request,
          latestRequestsRef.current.get(queuedResetKey) ?? null,
          {
            generation: resetGenerationRef.current,
            resetKey: resetKeyRef.current,
            valueKey: valueKeyRef.current,
          },
        );

      let flushSucceeded = false;
      const promise = result
        .then((flushResult) => {
          flushSucceeded = true;
          const isCurrent = isRequestCurrent();
          if (isCurrent) {
            lastSavedKeyRef.current = queuedKey;
            setLastSavedKey(queuedKey);
            queuedApplyLocal?.(store, queuedArgs, clientMutationId);
            setFailedSave(null);
            onFlushedRef.current?.(flushResult, queuedArgs);
          }
          return isCurrent;
        })
        .catch((error) => {
          if (isRequestCurrent()) {
            setFailedSave(request);
            onErrorRef.current?.(error, queuedArgs);
            const detail =
              typeof errorMessageRef.current === "function"
                ? errorMessageRef.current(error, queuedArgs)
                : errorMessageRef.current;
            toast.error("Changes weren’t saved", {
              id: `auto-save:${mutationName}`,
              description: detail,
            });
          }
          return false;
        })
        .finally(() => {
          if (
            pendingSavesRef.current.get(queuedResetKey)?.requestId === requestId
          ) {
            pendingSavesRef.current.delete(queuedResetKey);
          }
          const latestRequest = latestRequestsRef.current.get(queuedResetKey);
          if (latestRequest?.requestId === requestId) {
            const settledSave = {
              ...latestRequest,
              settled: true,
            };
            latestRequestsRef.current.set(queuedResetKey, settledSave);
            setLatestRequests((current) => {
              if (current.get(queuedResetKey)?.requestId !== requestId) {
                return current;
              }
              return new Map(current).set(queuedResetKey, settledSave);
            });
          }
        });

      const completion = promise.then(() => flushSucceeded);
      pendingSavesRef.current.set(queuedResetKey, {
        generation,
        requestId,
        resetKey: queuedResetKey,
        valueKey: queuedKey,
        promise,
        completion,
      });
      return promise;
    },
    [mutationName, sequencer, store],
  );

  const latestRequest = latestRequests.get(resetKey) ?? null;

  useLayoutEffect(() => {
    if (!enabled) {
      if (wasEnabledRef.current) {
        const nextGeneration = resetGenerationRef.current + 1;
        resetGenerationRef.current = nextGeneration;
        setResetGeneration(nextGeneration);
      }
      wasEnabledRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setEnabledBaselineKey(null);
      return;
    }

    if (!wasEnabledRef.current) {
      lastSavedKeyRef.current = valueKey;
      wasEnabledRef.current = true;
      setLastSavedKey(valueKey);
      setEnabledBaselineKey(valueKey);
      setFailedSave(null);
      return;
    }

    const divergentWritePending = isDivergentAutoSaveRequest(
      latestRequest,
      {
        generation: resetGenerationRef.current,
        resetKey,
        valueKey,
      },
    );
    const failedCurrentRequest =
      failedSave !== null &&
      isCurrentAutoSaveRequest(failedSave, latestRequest, {
        generation: resetGenerationRef.current,
        resetKey,
        valueKey,
      });

    if (valueKey === lastSavedKeyRef.current && !divergentWritePending) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (failedCurrentRequest) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (!autoSave) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    if (!canSave) {
      return;
    }

    timerRef.current = setTimeout(() => {
      void queueSave();
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    autoSave,
    canSave,
    delayMs,
    enabled,
    failedSave,
    latestRequest,
    queueSave,
    resetKey,
    valueKey,
  ]);

  const resetting = resetKey !== settledResetKey;
  const resuming = enabled && enabledBaselineKey === null;
  const divergentWritePending = isDivergentAutoSaveRequest(
    latestRequest,
    { generation: resetGeneration, resetKey, valueKey },
  );
  const currentRequestPending =
    latestRequest !== null &&
    !latestRequest.settled &&
    isCurrentAutoSaveRequest(latestRequest, latestRequest, {
      generation: resetGeneration,
      resetKey,
      valueKey,
    });
  const dirty =
    enabled &&
    !resetting &&
    !resuming &&
    (valueKey !== lastSavedKey ||
      divergentWritePending ||
      currentRequestPending);
  const current = {
    generation: resetGeneration,
    resetKey,
    valueKey,
  };
  const saving = currentRequestPending;
  const failed =
    failedSave !== null &&
    isCurrentAutoSaveRequest(failedSave, latestRequest, current);
  const status: AutoSaveStatus = failed
    ? "error"
    : !dirty
      ? "saved"
      : saving || (autoSave && canSave)
        ? "saving"
        : "unsaved";

  const saveNow = useCallback(
    (options?: { force?: boolean }) => queueSave(options),
    [queueSave],
  );

  return { saving, status, saveNow };
}
