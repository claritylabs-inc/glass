"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";

export interface EntityPreview {
  type: "policy" | "quote";
  id: string;
  page?: number; // optional page from ?page= param
  citedSections?: string[]; // section/endorsement titles or form numbers referenced in the agent answer
}

interface EntityPreviewContextValue {
  preview: EntityPreview | null;
  openPreview: (entity: EntityPreview) => void;
  closePreview: () => void;
}

const Ctx = createContext<EntityPreviewContextValue>({
  preview: null,
  openPreview: () => {},
  closePreview: () => {},
});

export function EntityPreviewProvider({ children }: { children: React.ReactNode }) {
  const [preview, setPreview] = useState<EntityPreview | null>(null);

  const openPreview = useCallback((entity: EntityPreview) => {
    setPreview(entity);
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
  }, []);

  const value = useMemo(
    () => ({ preview, openPreview, closePreview }),
    [preview, openPreview, closePreview],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntityPreview() {
  return useContext(Ctx);
}
