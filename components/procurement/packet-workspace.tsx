"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ProseMarkdown } from "@/components/prose-markdown";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function PacketWorkspace({
  requestId,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
}) {
  const packet = useQuery(api.procurementPacket.get, {
    requestId,
    audience: "client",
  });
  const operatorPacket = useQuery(api.procurementPacket.get, { requestId });
  const accept = useMutation(api.procurementPacket.acceptProposal);
  const reject = useMutation(api.procurementPacket.rejectProposal);
  const [workingSectionId, setWorkingSectionId] = useState<string | null>(null);

  if (!packet || !operatorPacket) {
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  const suggestions = operatorPacket.sections.filter(
    (section) => section.proposedBody || section.audienceProposed,
  );

  async function resolve(
    action: typeof accept,
    sectionId: Id<"procurementPacketSections">,
    success: string,
    failure: string,
  ) {
    setWorkingSectionId(sectionId);
    try {
      await action({ sectionId });
      toast.success(success);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, failure));
    } finally {
      setWorkingSectionId(null);
    }
  }

  return (
    <div className="space-y-4">
      <OperationalPanel as="section" aria-label="Submission packet document">
        <OperationalPanelBody className="space-y-4">
          <p
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Revision {packet.packetRevision} · Shared with the client and broker
            market
          </p>
          {packet.markdown ? (
            <ProseMarkdown>{packet.markdown}</ProseMarkdown>
          ) : (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              The packet is empty. Ask Spot to draft or update it from the
              request material.
            </p>
          )}
        </OperationalPanelBody>
      </OperationalPanel>

      {suggestions.length ? (
        <OperationalPanel as="section" aria-label="Suggested packet updates">
          <div className="divide-y divide-border">
            {suggestions.map((section) => (
              <div key={section._id} className="space-y-3 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className={typeStyle("heading.micro")}>
                    {section.heading}
                  </h2>
                  <StatusTag tone="info">Suggested update</StatusTag>
                </div>
                <ProseMarkdown>
                  {section.proposedBody || section.body}
                </ProseMarkdown>
                {section.proposedRationale ? (
                  <p
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {section.proposedRationale}
                  </p>
                ) : null}
                {!readOnly ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <PillButton
                      size="compact"
                      disabled={workingSectionId !== null}
                      onClick={() =>
                        void resolve(
                          accept,
                          section._id,
                          "Packet updated",
                          "Could not accept the packet update",
                        )
                      }
                    >
                      {workingSectionId === section._id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Accept
                    </PillButton>
                    <PillButton
                      size="compact"
                      variant="secondary"
                      disabled={workingSectionId !== null}
                      onClick={() =>
                        void resolve(
                          reject,
                          section._id,
                          "Suggestion dismissed",
                          "Could not dismiss the packet update",
                        )
                      }
                    >
                      Dismiss
                    </PillButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </OperationalPanel>
      ) : null}
    </div>
  );
}

type EditablePacketSection = {
  _id: Id<"procurementPacketSections">;
  key: string;
  heading: string;
  body: string;
};

function LoadedPacketEditor({
  requestId,
  sections: initialSections,
  packetRevision,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  sections: EditablePacketSection[];
  packetRevision: number;
  onClose: () => void;
}) {
  const updateSections = useMutation(api.procurementPacket.updateSections);
  const [sections] = useState(initialSections);
  const [expectedPacketRevision] = useState(packetRevision);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, section.body])),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const changed = sections.filter(
      (section) => drafts[section.key] !== section.body,
    );
    if (!changed.length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateSections({
        requestId,
        expectedPacketRevision,
        sections: changed.map((section) => ({
          key: section.key,
          body: drafts[section.key] ?? "",
        })),
      });
      toast.success(
        "Packet updated. Regenerate the link to share these changes.",
      );
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update the packet"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="Edit packet"
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </PillButton>
          <PillButton
            type="button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save packet
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        {sections.map((section) => (
          <label key={section._id} className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              {section.heading}
            </span>
            <Textarea
              disabled={saving}
              value={drafts[section.key] ?? ""}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [section.key]: event.target.value,
                }))
              }
              className="min-h-40"
              placeholder="Write this packet section in Markdown"
            />
          </label>
        ))}
      </div>
    </SettingsDrawer>
  );
}

export function PacketEditor({
  requestId,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  onClose: () => void;
}) {
  const packet = useQuery(api.procurementPacket.get, {
    requestId,
    audience: "client",
  });

  if (!packet) {
    return (
      <SettingsDrawer
        open
        onOpenChange={(open) => !open && onClose()}
        title="Edit packet"
      >
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SettingsDrawer>
    );
  }

  return (
    <LoadedPacketEditor
      key={requestId}
      requestId={requestId}
      sections={packet.sections}
      packetRevision={packet.packetRevision}
      onClose={onClose}
    />
  );
}
