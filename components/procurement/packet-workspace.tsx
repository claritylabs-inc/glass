"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { ProseMarkdown } from "@/components/prose-markdown";
import { typeStyle } from "@/lib/typography";

export function PacketWorkspace({ requestId }: { requestId: Id<"procurementRequests"> }) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  const accept = useMutation(api.procurementPacket.acceptProposal);
  const reject = useMutation(api.procurementPacket.rejectProposal);
  if (!packet)
    return (
      <div className={`p-6 text-muted-foreground ${typeStyle("body.default")}`}>
        Loading packet…
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={typeStyle("heading.section")}>Packet</h2>
          <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
            Revision {packet.packetRevision}
          </p>
        </div>
        <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {packet.gaps.length} canonical sections still empty
        </div>
      </div>
      <div className="space-y-4">
        {packet.sections.map((section) => (
          <section key={section._id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <h3 className={typeStyle("heading.micro")}>{section.heading}</h3>
              <span className={`text-muted-foreground ${typeStyle("label.eyebrow")}`}>
                {section.audience}
              </span>
            </div>
            <div className="mt-3"><ProseMarkdown>{section.body || "No content yet."}</ProseMarkdown></div>
            {section.proposedBody || section.audienceProposed ? <div className="mt-4 flex gap-2"><PillButton onClick={() => void accept({ sectionId: section._id })}>Accept proposal</PillButton><PillButton variant="secondary" onClick={() => void reject({ sectionId: section._id })}>Reject</PillButton></div> : null}
          </section>
        ))}
      </div>
    </div>
  );
}
