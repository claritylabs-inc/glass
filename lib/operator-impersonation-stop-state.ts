"use client";

import { useSyncExternalStore } from "react";

let stopping = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function beginOperatorImpersonationStop() {
  stopping = true;
  emit();
}

export function endOperatorImpersonationStop() {
  stopping = false;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return stopping;
}

function getServerSnapshot() {
  return false;
}

export function useIsStoppingOperatorImpersonation() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
