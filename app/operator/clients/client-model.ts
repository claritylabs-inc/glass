import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;

export type OperatorClientRow = OperatorClientList[number];

export function operatorClientStatusLabel(client: OperatorClientRow) {
  if (client.inviteStatus === "draft") return "Draft";
  if (client.inviteStatus === "invited") return "Invited";
  return client.operatorStatus === "live" ? "Live" : "Onboarding";
}
