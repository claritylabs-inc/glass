"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { ProseMarkdown } from "@/components/prose-markdown";
import { StatusTag } from "@/components/ui/status-tag";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const AUDIENCE_LABEL = {
  operator: "Operator only",
  client: "Client",
  broker: "Broker",
} as const;

export function PacketWorkspace({
  requestId,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
}) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  const accept = useMutation(api.procurementPacket.acceptProposal);
  const reject = useMutation(api.procurementPacket.rejectProposal);

  if (!packet)
    return (
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Loading packet…
      </p>
    );

  async function resolve(
    action: typeof accept,
    sectionId: Id<"procurementPacketSections">,
    failure: string,
  ) {
    try {
      await action({ sectionId });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, failure));
    }
  }

  return (
    <OperationalPanel as="section" aria-label="Packet sections">
      <OperationalPanelBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Revision {packet.packetRevision}
          </span>
          {packet.gaps.length > 0 ? (
            <StatusTag tone="warning">
              {packet.gaps.length} empty{" "}
              {packet.gaps.length === 1 ? "section" : "sections"}
            </StatusTag>
          ) : null}
        </div>
        {packet.sections.length === 0 ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            This packet has no sections yet.
          </p>
        ) : (
          packet.sections.map((section) => (
            <section
              key={section._id}
              className="border-b border-border pb-4 last:border-0 last:pb-0"
            >
              <div className="flex items-start justify-between gap-4">
                <h3 className={typeStyle("heading.micro")}>
                  {section.heading}
                </h3>
                <Badge variant="outline">
                  {AUDIENCE_LABEL[section.audience]}
                </Badge>
              </div>
              <div className="mt-2">
                <ProseMarkdown>
                  {section.body || "No content yet."}
                </ProseMarkdown>
              </div>
              {section.proposedBody || section.audienceProposed ? (
                <div className="mt-3 space-y-2">
                  {section.proposedBody ? (
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <p
                        className={`text-muted-foreground ${typeStyle("label.eyebrow")}`}
                      >
                        Proposed
                      </p>
                      <div className="mt-1">
                        <ProseMarkdown>{section.proposedBody}</ProseMarkdown>
                      </div>
                      {section.proposedRationale ? (
                        <p
                          className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
                        >
                          {section.proposedRationale}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {section.audienceProposed ? (
                    <p
                      className={`text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      Proposed visibility:{" "}
                      {AUDIENCE_LABEL[section.audienceProposed]}
                    </p>
                  ) : null}
                  {!readOnly ? (
                    <div className="flex gap-2">
                      <PillButton
                        size="compact"
                        onClick={() =>
                          void resolve(
                            accept,
                            section._id,
                            "Could not accept the proposed section",
                          )
                        }
                      >
                        Accept
                      </PillButton>
                      <PillButton
                        size="compact"
                        variant="secondary"
                        onClick={() =>
                          void resolve(
                            reject,
                            section._id,
                            "Could not reject the proposed section",
                          )
                        }
                      >
                        Reject
                      </PillButton>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))
        )}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
