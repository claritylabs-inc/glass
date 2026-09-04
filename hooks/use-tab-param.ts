"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Keeps a tab strip in the `?tab=` query so operators can link to and refresh
 * into a specific tab. The first tab is the default and stays out of the URL.
 */
export function useTabParam<T extends string>(tabs: readonly [T, ...T[]]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get("tab") as T | null;
  const activeTab =
    requested && tabs.includes(requested) ? requested : tabs[0];

  const selectTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === tabs[0]) next.delete("tab");
      else next.set("tab", tab);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams, tabs],
  );

  return [activeTab, selectTab] as const;
}
