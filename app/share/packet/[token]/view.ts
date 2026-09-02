import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

export type PacketView = {
  state: "ready";
  linkId: Id<"procurementPacketLinks">;
  requestId: Id<"procurementRequests">;
  recipientLabel: string;
  expiresAt: number;
  packetRevisionAtIssue: number;
  sections: Array<{ _id: string; heading: string; body: string; order: number }>;
  markdown: string;
  files: Array<{ _id: string; name: string; brokerRelease: "listed" | "attached" }>;
} | null;

const getPacket = makeFunctionReference<"query", { token: string }, PacketView>("procurementPacket:getByToken");

export function loadPacket(token: string) {
  return fetchQuery(getPacket, { token });
}
