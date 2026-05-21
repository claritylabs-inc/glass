"use client";

export function createClientMutationId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}:${Math.random().toString(36).slice(2)}`;
}
