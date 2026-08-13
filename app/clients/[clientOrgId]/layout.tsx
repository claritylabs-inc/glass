"use client";

import type { ReactNode } from "react";
import { useClientWorkspaceActions } from "../client-workspace-shell";

export function useClientDetailActions() {
  return useClientWorkspaceActions();
}

export default function ClientDetailLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
