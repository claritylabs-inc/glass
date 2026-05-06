"use client";

import { createContext, useContext } from "react";

export const SettingsActionsContext = createContext<{
  setActions: (node: React.ReactNode) => void;
  setRightPanel: (node: React.ReactNode) => void;
}>({ setActions: () => {}, setRightPanel: () => {} });

export function useSettingsActions() {
  return useContext(SettingsActionsContext);
}
