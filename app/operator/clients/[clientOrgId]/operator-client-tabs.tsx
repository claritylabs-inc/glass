"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Id } from "@/convex/_generated/dataModel";

export const OPERATOR_CLIENT_SETTINGS_TABS = [
  { id: "features", label: "Beta features" },
  { id: "channels", label: "Agent channels" },
] as const;

export type OperatorClientPageTab =
  | "overview"
  | "team"
  | (typeof OPERATOR_CLIENT_SETTINGS_TABS)[number]["id"];

export function parseOperatorClientSection(
  value: string | null,
): OperatorClientPageTab {
  if (value === "email" || value === "imessage" || value === "slack") {
    return "channels";
  }
  return value === "team" ||
    OPERATOR_CLIENT_SETTINGS_TABS.some((tab) => tab.id === value)
    ? (value as OperatorClientPageTab)
    : "overview";
}

export function OperatorClientSettingsTabs({
  clientOrgId,
  value,
}: {
  clientOrgId: Id<"organizations"> | string;
  value: (typeof OPERATOR_CLIENT_SETTINGS_TABS)[number]["id"];
}) {
  const router = useRouter();

  return (
    <div className="-mx-1 overflow-x-auto px-1 scrollbar-hide">
      <Tabs
        value={value}
        onValueChange={(tab) =>
          router.push(`/operator/clients/${clientOrgId}?tab=${tab}`)
        }
      >
        <TabsList variant="pill" className="min-w-max">
          {OPERATOR_CLIENT_SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
