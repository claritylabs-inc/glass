"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Copy, Loader2, Mail, RefreshCw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const AUDIENCE_LABEL = {
  operator: "Operator only",
  client: "Client",
  broker: "Broker",
} as const;

const LINK_LIFETIME_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
] as const;

function outreachLabel(outreach: { brokerName: string; contactName?: string }) {
  return outreach.contactName
    ? `${outreach.brokerName} · ${outreach.contactName}`
    : outreach.brokerName;
}

export function PacketWorkspace({
  requestId,
  outreaches,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  outreaches: Array<{
    _id: Id<"procurementBrokerOutreaches">;
    brokerName: string;
    contactName?: string;
    contactEmail?: string;
  }>;
  readOnly: boolean;
}) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  const packetLinks = useQuery(api.procurementPacket.listLinks, { requestId });
  const [outreachId, setOutreachId] = useState<string>(
    outreaches[0]?._id ?? "",
  );
  const selectedOutreach =
    outreaches.find((outreach) => outreach._id === outreachId) ?? outreaches[0];
  const preview = useQuery(
    api.procurementPacket.preview,
    selectedOutreach
      ? {
          requestId,
          outreachId: selectedOutreach._id,
        }
      : "skip",
  );
  const accept = useMutation(api.procurementPacket.acceptProposal);
  const reject = useMutation(api.procurementPacket.rejectProposal);
  const mintLink = useMutation(api.procurementPacket.mintLink);
  const rotateLink = useMutation(api.procurementPacket.rotateLink);
  const revokeLink = useMutation(api.procurementPacket.revokeLink);
  const sendPacket = useAction(api.actions.procurementPacketSend.send);
  const [working, setWorking] = useState<string | null>(null);
  const [linkLifetimeDays, setLinkLifetimeDays] = useState("30");
  const [showPreview, setShowPreview] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<{
    id: Id<"procurementPacketLinks">;
    url: string;
    expiresAt: number;
    sectionCount: number;
    fileCount: number;
  } | null>(null);

  if (!packet || !packetLinks)
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

  async function createLink() {
    if (!selectedOutreach) return;
    setWorking("create");
    try {
      const result = await mintLink({
        requestId,
        outreachId: selectedOutreach._id,
        recipientLabel:
          selectedOutreach.contactName || selectedOutreach.brokerName,
        recipientEmail: selectedOutreach.contactEmail,
        expiresAt: dayjs().add(Number(linkLifetimeDays), "day").valueOf(),
      });
      setFreshLink({
        id: result.id,
        url: result.url,
        expiresAt: result.expiresAt,
        sectionCount: result.sectionCount,
        fileCount: result.fileCount,
      });
      toast.success("Broker packet link created");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the packet link"),
      );
    } finally {
      setWorking(null);
    }
  }

  async function sendLink() {
    if (!selectedOutreach) return;
    setWorking("send");
    try {
      const result = await sendPacket({
        requestId,
        outreachId: selectedOutreach._id,
        expiresAt: dayjs().add(Number(linkLifetimeDays), "day").valueOf(),
      });
      setFreshLink({
        id: result.linkId,
        url: result.url,
        expiresAt: result.expiresAt,
        sectionCount: result.sectionCount,
        fileCount: result.fileCount,
      });
      if (result.deliveryStatus === "sent") {
        toast.success(`Packet sent to ${result.recipientEmail}`);
      } else {
        toast.error(result.deliveryError || "The packet email was not sent");
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not send the broker packet"),
      );
    } finally {
      setWorking(null);
    }
  }

  async function rotate(linkId: Id<"procurementPacketLinks">) {
    setWorking(linkId);
    try {
      const result = await rotateLink({
        linkId,
        expiresAt: dayjs().add(Number(linkLifetimeDays), "day").valueOf(),
      });
      setFreshLink({
        id: result.id,
        url: result.url,
        expiresAt: result.expiresAt,
        sectionCount: result.sectionCount,
        fileCount: result.fileCount,
      });
      toast.success("Packet link rotated");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not rotate the packet link"),
      );
    } finally {
      setWorking(null);
    }
  }

  async function revoke(linkId: Id<"procurementPacketLinks">) {
    setWorking(linkId);
    try {
      await revokeLink({ linkId });
      if (freshLink?.id === linkId) setFreshLink(null);
      toast.success("Packet link revoked");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not revoke the packet link"),
      );
    } finally {
      setWorking(null);
    }
  }

  async function copyFreshUrl() {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink.url);
      toast.success("Packet link copied");
    } catch {
      toast.error("Could not copy the packet link");
    }
  }

  const visibleLinks = showAllLinks ? packetLinks : packetLinks.slice(0, 8);

  return (
    <div className="space-y-4">
      <OperationalPanel as="section" aria-label="Broker packet sharing">
        <OperationalPanelBody className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <label
                  htmlFor="packet-broker-recipient"
                  className={`block text-muted-foreground ${typeStyle("label.field")}`}
                >
                  Broker recipient
                </label>
                <Select
                  value={selectedOutreach?._id ?? ""}
                  items={outreaches.map((outreach) => ({
                    value: outreach._id,
                    label: outreachLabel(outreach),
                  }))}
                  onValueChange={(value) => {
                    setOutreachId(value ?? "");
                    setFreshLink(null);
                    setShowPreview(false);
                  }}
                >
                  <SelectTrigger
                    id="packet-broker-recipient"
                    className="w-full sm:min-w-60"
                  >
                    <SelectValue placeholder="Select broker outreach" />
                  </SelectTrigger>
                  <SelectContent>
                    {outreaches.map((outreach) => (
                      <SelectItem key={outreach._id} value={outreach._id}>
                        {outreachLabel(outreach)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                    onValueChange={(value) =>
                      setLinkLifetimeDays(value ?? "30")
                    }
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
            </div>
            <div className="flex flex-wrap gap-2">
              <PillButton
                variant="secondary"
                disabled={!selectedOutreach}
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview ? "Hide preview" : "Preview"}
              </PillButton>
              {!readOnly ? (
                <>
                  <PillButton
                    variant="secondary"
                    disabled={!selectedOutreach || working !== null}
                    onClick={() => void createLink()}
                  >
                    {working === "create" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Create magic link
                  </PillButton>
                  <PillButton
                    disabled={
                      !selectedOutreach?.contactEmail || working !== null
                    }
                    onClick={() => void sendLink()}
                  >
                    {working === "send" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Mail className="size-3.5" />
                    )}
                    Send packet
                  </PillButton>
                </>
              ) : null}
            </div>
          </div>

          {selectedOutreach ? (
            <div
              className={`flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              <span>{selectedOutreach.contactEmail || "No contact email"}</span>
              <span>
                {preview
                  ? `${preview.sections.length} sections · ${preview.files.length} released files`
                  : "Loading preview…"}
              </span>
              {preview?.gaps.length ? (
                <span className="text-warning">
                  {preview.gaps.length} empty packet sections
                </span>
              ) : null}
            </div>
          ) : (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Add a broker outreach before sharing this packet.
            </p>
          )}

          {showPreview && selectedOutreach ? (
            <section
              className="space-y-3 border-t border-border pt-4"
              aria-label="Broker packet preview"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className={typeStyle("heading.micro")}>Broker preview</h2>
                {preview?.gaps.length ? (
                  <StatusTag tone="warning">
                    {preview.gaps.length} empty{" "}
                    {preview.gaps.length === 1 ? "section" : "sections"}
                  </StatusTag>
                ) : preview ? (
                  <StatusTag tone="success">Ready</StatusTag>
                ) : null}
              </div>
              {preview === undefined ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  {preview.markdown ? (
                    <div className="border-y border-border py-4">
                      <ProseMarkdown>{preview.markdown}</ProseMarkdown>
                    </div>
                  ) : (
                    <p
                      className={`text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      No broker-visible packet sections yet.
                    </p>
                  )}
                  {preview.files.length ? (
                    <div className="divide-y divide-border border-y border-border">
                      {preview.files.map((file) => (
                        <div
                          key={file.fileItemId}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <span
                            className={`min-w-0 truncate ${typeStyle("body.default")}`}
                          >
                            {file.name}
                          </span>
                          <Badge variant="outline">
                            {file.release === "attached"
                              ? "Attached"
                              : "Listed only"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {freshLink ? (
            <div className="min-w-0 space-y-2 border-t border-border pt-3">
              <p
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                New link · expires {formatDisplayDateTime(freshLink.expiresAt)}{" "}
                · {freshLink.sectionCount} sections · {freshLink.fileCount}{" "}
                files
              </p>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("technical.codeCompact")}`}
                >
                  {freshLink.url}
                </code>
                <PillButton
                  size="compact"
                  variant="secondary"
                  onClick={() => void copyFreshUrl()}
                >
                  <Copy className="size-3.5" />
                  Copy link
                </PillButton>
              </div>
            </div>
          ) : null}

          <section
            className="space-y-2 border-t border-border pt-4"
            aria-label="Packet link history"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className={typeStyle("heading.micro")}>Link history</h2>
              {packetLinks.length ? (
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {packetLinks.length}{" "}
                  {packetLinks.length === 1 ? "link" : "links"}
                </span>
              ) : null}
            </div>
            {packetLinks.length ? (
              <div className="divide-y divide-border border-y border-border">
                {visibleLinks.map((link) => (
                  <div key={link.linkId} className="py-3 last:pb-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={typeStyle("body.medium")}>
                            {link.brokerName}
                          </span>
                          <StatusTag
                            tone={
                              link.state === "active"
                                ? link.stale
                                  ? "warning"
                                  : "success"
                                : "neutral"
                            }
                          >
                            {link.stale && link.state === "active"
                              ? "stale"
                              : link.state}
                          </StatusTag>
                          {link.deliveryStatus !== "not_sent" ? (
                            <StatusTag
                              tone={
                                link.deliveryStatus === "sent"
                                  ? "success"
                                  : link.deliveryStatus === "failed"
                                    ? "danger"
                                    : "neutral"
                              }
                            >
                              {link.deliveryStatus}
                            </StatusTag>
                          ) : null}
                        </div>
                        <p
                          className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {link.recipientLabel}
                          {link.recipientEmail
                            ? ` · ${link.recipientEmail}`
                            : ""}
                        </p>
                        <p
                          className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Created {formatDisplayDateTime(link.createdAt)} ·
                          Expires {formatDisplayDateTime(link.expiresAt)} ·{" "}
                          {link.sectionCount !== null
                            ? `${link.sectionCount} sections · `
                            : ""}
                          {link.fileCount !== null
                            ? `${link.fileCount} files · `
                            : ""}
                          {link.viewCount}{" "}
                          {link.viewCount === 1 ? "view" : "views"}
                          {link.lastViewedAt
                            ? ` · Last viewed ${formatDisplayDateTime(link.lastViewedAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <PillButton
                          size="compact"
                          variant="secondary"
                          onClick={() =>
                            setExpandedLinkId((current) =>
                              current === link.linkId ? null : link.linkId,
                            )
                          }
                        >
                          {expandedLinkId === link.linkId
                            ? "Hide details"
                            : "Details"}
                        </PillButton>
                        {!readOnly && link.state === "active" ? (
                          <>
                            <PillButton
                              size="compact"
                              variant="secondary"
                              disabled={working !== null}
                              onClick={() => void rotate(link.linkId)}
                            >
                              <RefreshCw className="size-3.5" />
                              Rotate
                            </PillButton>
                            <PillButton
                              size="compact"
                              variant="destructive"
                              disabled={working !== null}
                              onClick={() => void revoke(link.linkId)}
                            >
                              Revoke
                            </PillButton>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {expandedLinkId === link.linkId ? (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <p
                          className={`text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Issued from packet revision{" "}
                          {link.packetRevisionAtIssue}
                          {link.sentAt
                            ? ` · Sent ${formatDisplayDateTime(link.sentAt)}`
                            : link.deliveryStatus === "pending"
                              ? " · Delivery pending"
                              : " · Not sent by Spot"}
                        </p>
                        {link.deliveryStatus === "failed" &&
                        link.deliveryError ? (
                          <p
                            className={`break-words text-destructive ${typeStyle("caption.default")}`}
                          >
                            Delivery failed: {link.deliveryError}
                          </p>
                        ) : null}
                        <div>
                          <p
                            className={`text-muted-foreground ${typeStyle("label.metadata")}`}
                          >
                            Released files
                          </p>
                          {link.includedArtifacts === null ? (
                            <p
                              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                            >
                              File details are unavailable for this link.
                            </p>
                          ) : link.includedArtifacts.length ? (
                            <div className="mt-1 divide-y divide-border">
                              {link.includedArtifacts.map((artifact) => (
                                <div
                                  key={artifact.fileItemId}
                                  className="flex items-center justify-between gap-3 py-2"
                                >
                                  <span
                                    className={`min-w-0 truncate ${typeStyle("body.default")}`}
                                  >
                                    {artifact.name}
                                  </span>
                                  <Badge variant="outline">
                                    {artifact.release === "attached"
                                      ? "Attached"
                                      : "Listed only"}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p
                              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                            >
                              No files were released.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                No packet links have been created.
              </p>
            )}
            {packetLinks.length > 8 ? (
              <PillButton
                size="compact"
                variant="secondary"
                onClick={() => setShowAllLinks((current) => !current)}
              >
                {showAllLinks
                  ? "Show fewer"
                  : `Show all ${packetLinks.length} links`}
              </PillButton>
            ) : null}
          </section>
        </OperationalPanelBody>
      </OperationalPanel>

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
    </div>
  );
}
