"use client";

import { useSyncExternalStore } from "react";

let returnHref: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function beginOperatorImpersonationStop(nextReturnHref: string) {
  returnHref = nextReturnHref;
  emit();
}

export function endOperatorImpersonationStop() {
  returnHref = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStoppingSnapshot() {
  return returnHref !== null;
}

function getServerStoppingSnapshot() {
  return false;
}

export function useIsStoppingOperatorImpersonation() {
  return useSyncExternalStore(
    subscribe,
    getStoppingSnapshot,
    getServerStoppingSnapshot,
  );
}

function getReturnHrefSnapshot() {
  return returnHref;
}

function getServerReturnHrefSnapshot() {
  return null;
}

export function useOperatorImpersonationStopReturnHref() {
  return useSyncExternalStore(
    subscribe,
    getReturnHrefSnapshot,
    getServerReturnHrefSnapshot,
  );
}
