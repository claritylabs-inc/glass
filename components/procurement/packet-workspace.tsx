"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ProseMarkdown } from "@/components/prose-markdown";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const LINK_LIFETIME_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
] as const;

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

export function PacketSharingWorkspace({
  requestId,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
}) {
  const preview = useQuery(api.procurementPacket.preview, { requestId });
  const links = useQuery(api.procurementPacket.listLinks, { requestId });
  const mintLink = useMutation(api.procurementPacket.mintLink);
  const rotateLink = useMutation(api.procurementPacket.rotateLink);
  const revokeLink = useMutation(api.procurementPacket.revokeLink);
  const [working, setWorking] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [linkLifetimeDays, setLinkLifetimeDays] = useState("30");
  const [freshLink, setFreshLink] = useState<{
    id: Id<"procurementPacketLinks">;
    url: string;
  } | null>(null);

  if (!preview || !links) {
    return (
      <OperationalPanel className="flex h-24 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  const activeLink = links.find(
    (link) => link.outreachId === null && link.state === "active",
  );

  async function createOrReplace() {
    setWorking(true);
    try {
      const result = activeLink
        ? await rotateLink({
            linkId: activeLink.linkId,
            expiresInDays: Number(linkLifetimeDays),
          })
        : await mintLink({
            requestId,
            expiresInDays: Number(linkLifetimeDays),
          });
      setFreshLink({ id: result.id, url: result.url });
      toast.success(
        activeLink ? "Packet link replaced" : "Packet link created",
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the packet link"),
      );
    } finally {
      setWorking(false);
    }
  }

  async function copyLink() {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink.url);
      toast.success("Packet link copied");
    } catch {
      toast.error("Could not copy the packet link");
    }
  }

  async function revoke() {
    if (!activeLink) return;
    setWorking(true);
    try {
      await revokeLink({ linkId: activeLink.linkId });
      setFreshLink(null);
      toast.success("Packet link revoked");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not revoke the packet link"),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <OperationalPanel as="section" aria-label="Broker packet sharing">
      <OperationalPanelBody className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className={typeStyle("body.medium")}>Shared packet link</p>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              One packet and one link for every broker in this market.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {!readOnly ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="packet-link-lifetime"
                  className={`block text-muted-foreground ${typeStyle("label.field")}`}
                >
                  Link lifetime
                </label>
                <Select
                  value={linkLifetimeDays}
                  items={LINK_LIFETIME_OPTIONS}
                  onValueChange={(value) => setLinkLifetimeDays(value ?? "30")}
                >
                  <SelectTrigger
                    id="packet-link-lifetime"
                    className="w-full sm:w-32"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_LIFETIME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <PillButton
                variant="secondary"
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview ? "Hide preview" : "Preview packet"}
              </PillButton>
              {!readOnly ? (
                freshLink && activeLink?.linkId === freshLink.id ? (
                  <PillButton
                    disabled={working}
                    onClick={() => void copyLink()}
                  >
                    <Copy className="size-3.5" />
                    Copy link
                  </PillButton>
                ) : (
                  <PillButton
                    disabled={working}
                    onClick={() => void createOrReplace()}
                  >
                    {working ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : activeLink ? (
                      <RefreshCw className="size-3.5" />
                    ) : null}
                    {activeLink ? "Replace link" : "Create link"}
                  </PillButton>
                )
              ) : null}
            </div>
          </div>
        </div>

        {activeLink ? (
          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusTag tone={activeLink.stale ? "warning" : "success"}>
                  {activeLink.stale ? "Packet changed" : "Active"}
                </StatusTag>
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Expires {formatDisplayDateTime(activeLink.expiresAt)} ·{" "}
                  {activeLink.viewCount}{" "}
                  {activeLink.viewCount === 1 ? "view" : "views"}
                </span>
              </div>
              {freshLink && activeLink.linkId === freshLink.id ? (
                <code
                  className={`mt-2 block truncate text-foreground ${typeStyle("technical.codeCompact")}`}
                >
                  {freshLink.url}
                </code>
              ) : (
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  For security, the URL is shown only when created. Replace it
                  to copy a new one.
                </p>
              )}
            </div>
            {!readOnly ? (
              <PillButton
                size="compact"
                variant="destructive"
                disabled={working}
                onClick={() => void revoke()}
              >
                Revoke
              </PillButton>
            ) : null}
          </div>
        ) : (
          <p
            className={`border-t border-border pt-3 text-muted-foreground ${typeStyle("body.default")}`}
          >
            No active packet link.
          </p>
        )}

        {showPreview ? (
          <div className="space-y-4 border-t border-border pt-4">
            {preview.markdown ? (
              <ProseMarkdown>{preview.markdown}</ProseMarkdown>
            ) : (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                The shared packet is empty.
              </p>
            )}
            {preview.files.length ? (
              <div className="divide-y divide-border border-y border-border">
                {preview.files.map((file) => (
                  <div
                    key={file.fileItemId}
                    className={`flex items-center justify-between gap-3 py-3 ${typeStyle("body.default")}`}
                  >
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {file.release === "attached" ? "Downloadable" : "Listed"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
