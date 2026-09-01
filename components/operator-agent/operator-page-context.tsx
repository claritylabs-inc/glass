"use client";

import { useEffect, useMemo } from "react";

import {
  usePageContext,
  type PageContext,
} from "@/hooks/use-page-context";

export function OperatorPageContextRegistration({
  context,
}: {
  context: PageContext;
}) {
  const { setPageContext } = usePageContext();
  const stableContext = useMemo(
    () => ({
      pageType: context.pageType,
      entityId: context.entityId,
      summary: context.summary,
    }),
    [context.entityId, context.pageType, context.summary],
  );

  useEffect(() => {
    setPageContext(stableContext);
    return () => setPageContext(null);
  }, [setPageContext, stableContext]);

  return null;
}

export function operatorPageContextKey(context: PageContext) {
  return `${context.pageType}:${context.entityId ?? "page"}`;
}

export function operatorPageContextLabel(context: PageContext) {
  return context.summary?.trim() || context.pageType.replaceAll("_", " ");
}

export function operatorPageContextFromPathname(
  pathname: string,
): PageContext | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "operator") return null;

  if (segments[1] === "policies" && segments[2]) {
    return {
      pageType: "policy",
      entityId: segments[2],
      summary: "Current policy",
    };
  }

  const summaryByArea: Record<string, string> = {
    brokers: "Broker organizations",
    channels: "Agent channels",
    clients: "Client organizations",
    compliance: "Client compliance",
    "demo-leads": "Demo leads",
    policies: "Client policies",
    profile: "Operator profile",
    routing: "Model routing",
    telemetry: "System telemetry",
  };
  const area = segments[1] ?? "clients";

  return {
    pageType: `operator_${area.replaceAll("-", "_")}`,
    entityId: segments[2],
    summary: summaryByArea[area] ?? "Operator portal",
  };
}
