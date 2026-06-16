"use client";

import { useState } from "react";
import dayjs from "dayjs";
import { Mail, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OperatorSidebar } from "../operator-sidebar";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurfaceButton } from "@/components/ui/action-surface";
import { FadeIn } from "@/components/ui/fade-in";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import {
  useCachedOperatorCurrent,
  useCachedOperatorDemoSalesTranscriptDetail,
  useCachedOperatorDemoSalesTranscripts,
} from "@/lib/sync/operator-cached-queries";

type DemoStage =
  | "new"
  | "engaged"
  | "qualified"
  | "booking_intent"
  | "cta_sent"
  | "signup_intent"
  | "not_fit"
  | "rate_limited";
type DemoCtaStatus =
  | "not_shown"
  | "asked_for_email"
  | "cal_link_sent"
  | "signup_link_sent";

type TranscriptRow = {
  _id: string;
  channel: "email" | "imessage";
  senderContact?: string;
  leadName?: string;
  leadCompany?: string;
  leadEmail?: string;
  stage: DemoStage;
  ctaStatus: DemoCtaStatus;
  summary: string;
  lastUpdatedAt: number;
};

type TimelineLog = {
  _id: string;
  direction: "inbound" | "outbound" | "system";
  content: string;
  subject?: string;
  createdAt: number;
};

const STAGE_LABELS: Record<DemoStage, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  booking_intent: "Booking intent",
  cta_sent: "CTA sent",
  signup_intent: "Signup intent",
  not_fit: "Not fit",
  rate_limited: "Rate limited",
};

const CTA_LABELS: Record<DemoCtaStatus, string> = {
  not_shown: "No CTA",
  asked_for_email: "Asked for email",
  cal_link_sent: "Cal link sent",
  signup_link_sent: "Signup link sent",
};

function channelLabel(channel?: string) {
  return channel === "imessage" ? "iMessage" : "Email";
}

function stageLabel(stage?: string) {
  switch (stage) {
    case "new":
    case "engaged":
    case "qualified":
    case "booking_intent":
    case "cta_sent":
    case "signup_intent":
    case "not_fit":
    case "rate_limited":
      return STAGE_LABELS[stage];
    default:
      return "Unknown";
  }
}

function ctaLabel(ctaStatus?: string) {
  switch (ctaStatus) {
    case "not_shown":
    case "asked_for_email":
    case "cal_link_sent":
    case "signup_link_sent":
      return CTA_LABELS[ctaStatus];
    default:
      return "Unknown";
  }
}

function leadTitle(row: TranscriptRow) {
  return row.leadName ?? row.leadCompany ?? row.senderContact ?? "Unknown lead";
}

function leadSubtitle(row: TranscriptRow) {
  return [row.leadCompany, row.leadEmail].filter(Boolean).join(" · ");
}

function formatTime(value?: number) {
  return value ? dayjs(value).format("MMM D, YYYY · h:mm A") : "Unknown time";
}

function Timeline({ logs }: { logs?: TimelineLog[] }) {
  if (!logs?.length) {
    return <p className="text-base text-muted-foreground">No turns recorded.</p>;
  }

  return (
    <div className="divide-y divide-foreground/6 rounded-lg border border-foreground/6">
      {logs.map((log) => (
        <div key={log._id} className="px-4 py-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-label text-muted-foreground">
            <span>{log.direction === "inbound" ? "Prospect" : "Glass"}</span>
            <span>{formatTime(log.createdAt)}</span>
          </div>
          {log.subject ? (
            <p className="mb-1 text-base font-medium text-foreground">
              {log.subject}
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-base leading-6 text-foreground">
            {log.content}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function OperatorDemoLeadsPage() {
  const current = useCachedOperatorCurrent();
  const transcripts = useCachedOperatorDemoSalesTranscripts();
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(null);
  const transcriptDetail =
    useCachedOperatorDemoSalesTranscriptDetail(selectedTranscriptId);

  const rightPanel = (
    <SettingsDrawer
      open={Boolean(selectedTranscriptId)}
      onOpenChange={(open) => {
        if (!open) setSelectedTranscriptId(null);
      }}
      title="Demo chat"
    >
      {transcriptDetail ? (
        <div className="flex flex-col gap-4">
          <OperationalLabelValueList title="Lead">
            <OperationalLabelValueRow
              label="Name"
              value={transcriptDetail.transcript.leadName ?? "Unknown"}
            />
            <OperationalLabelValueRow
              label="Company"
              value={transcriptDetail.transcript.leadCompany ?? "Unknown"}
            />
            <OperationalLabelValueRow
              label="Email"
              value={transcriptDetail.transcript.leadEmail ?? "Unknown"}
            />
            <OperationalLabelValueRow
              label="Channel"
              value={channelLabel(transcriptDetail.transcript.channel)}
            />
            <OperationalLabelValueRow
              label="Stage"
              value={stageLabel(transcriptDetail.transcript.stage)}
            />
            <OperationalLabelValueRow
              label="CTA"
              value={ctaLabel(transcriptDetail.transcript.ctaStatus)}
            />
            <OperationalLabelValueRow
              label="Next step"
              value={transcriptDetail.transcript.nextStep}
            />
          </OperationalLabelValueList>
          <Timeline logs={transcriptDetail.logs} />
        </div>
      ) : (
        <p className="text-base text-muted-foreground">Loading chat.</p>
      )}
    </SettingsDrawer>
  );

  return (
    <AppShell
      breadcrumbDetail="Demo leads"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="demo-leads"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      rightPanel={rightPanel}
    >
      <FadeIn when={true} duration={0.12}>
        {(transcripts ?? []).length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base text-muted-foreground/40">
              No public demo chats
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {(transcripts ?? []).map((row: TranscriptRow) => {
              const Icon = row.channel === "imessage" ? MessageCircle : Mail;
              const subtitle = leadSubtitle(row);

              return (
                <ActionSurfaceButton
                  key={row._id}
                  className="group flex w-full items-center gap-3 px-4 py-3"
                  onClick={() => setSelectedTranscriptId(row._id)}
                >
                  <div className="shrink-0 text-muted-foreground/30">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-foreground">
                      {leadTitle(row)}
                    </p>
                    <p className="text-label text-muted-foreground/40">
                      {formatTime(row.lastUpdatedAt)} · {channelLabel(row.channel)}
                      {" · "}
                      {stageLabel(row.stage)} · {ctaLabel(row.ctaStatus)}
                    </p>
                    {subtitle ? (
                      <p className="truncate text-label text-muted-foreground/40">
                        {subtitle}
                      </p>
                    ) : null}
                    <p className="line-clamp-2 text-base text-muted-foreground">
                      {row.summary}
                    </p>
                  </div>
                </ActionSurfaceButton>
              );
            })}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
