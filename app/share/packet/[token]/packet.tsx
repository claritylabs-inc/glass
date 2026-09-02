"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { SpotWordmark } from "@/components/ui/spot-wordmark";
import { ProseMarkdown } from "@/components/prose-markdown";
import type { Id } from "@/convex/_generated/dataModel";
import type { PacketView } from "./view";

const getPacket = makeFunctionReference<"query", { token: string }, PacketView>("procurementPacket:getByToken");
const recordView = makeFunctionReference<"mutation", { linkId: Id<"procurementPacketLinks">; path: string; userAgent?: string }, { ok: boolean }>("procurementPacket:recordView");

export function Packet({ token, initialView }: { token: string; initialView: PacketView }) {
  const live = useQuery(getPacket, { token });
  const view = live === undefined ? initialView : live;
  const record = useMutation(recordView);
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || view?.state !== "ready") return;
    recorded.current = true;
    void record({ linkId: view.linkId, path: `/share/packet/${token}`, userAgent: navigator.userAgent });
  }, [record, token, view]);
  if (!view) return <main className="mx-auto max-w-3xl px-6 py-12"><SpotWordmark /><h1 className="mt-12 text-xl">Packet unavailable</h1></main>;
  return <main className="mx-auto max-w-4xl px-6 py-8 print:max-w-none"><header className="border-b border-border pb-6"><SpotWordmark /><p className="mt-6 text-sm text-muted-foreground">Prepared for {view.recipientLabel}</p></header><article className="prose prose-neutral mt-8 max-w-none"><ProseMarkdown>{view.markdown}</ProseMarkdown></article><p className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">This submission is confidential and watermarked for {view.recipientLabel}.</p></main>;
}
