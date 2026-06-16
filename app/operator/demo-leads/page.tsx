"use client";

import { useState } from "react";
import dayjs from "dayjs";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { Mail, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OperatorSidebar } from "../operator-sidebar";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurfaceButton } from "@/components/ui/action-surface";
import { FadeIn } from "@/components/ui/fade-in";
import {
  useCachedOperatorCurrent,
  useCachedOperatorDemoSalesTranscriptDetail,
  useCachedOperatorDemoSalesTranscripts,
} from "@/lib/sync/operator-cached-queries";

type TranscriptRow = {
  _id: string;
  channel: "email" | "imessage";
  senderContact?: string;
  leadName?: string;
  leadCompany?: string;
  leadEmail?: string;
  lastUpdatedAt: number;
};

type TimelineLog = {
  _id: string;
  direction: "inbound" | "outbound" | "system";
  content: string;
  subject?: string;
  createdAt: number;
};

function channelIcon(channel?: string) {
  const Icon = channel === "imessage" ? MessageCircle : Mail;
  return <Icon className="h-4 w-4" />;
}

function formatShortTime(value?: number) {
  return value ? dayjs(value).format("MMM D, h:mm A") : "Unknown time";
}

function formatContact(value?: string) {
  const contact = value?.trim();
  if (!contact) return "Unknown";
  if (contact.includes("@")) return contact;
  const phone = parsePhoneNumberFromString(contact, "US");
  return phone?.isValid() ? phone.formatNational() : contact;
}

function drawerTitle(row?: TranscriptRow) {
  if (!row) return "Demo chat";
  const contact = formatContact(row.senderContact);
  const primary =
    contact !== "Unknown"
      ? contact
      : (row.leadName ?? row.leadCompany ?? row.leadEmail ?? "Unknown");
  const secondary = [row.leadName, row.leadCompany, row.leadEmail]
    .filter((item) => item && item !== primary)
    .join(" · ");

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted-foreground/40">
        {channelIcon(row.channel)}
      </span>
      <span className="min-w-0">
        <span className="block truncate">{primary}</span>
        {secondary ? (
          <span className="block truncate text-label font-normal text-muted-foreground/40">
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function Timeline({ logs }: { logs?: TimelineLog[] }) {
  const messages = logs?.filter((log) => log.direction !== "system") ?? [];
  if (!messages.length) {
    return <p className="text-base text-muted-foreground">No turns recorded.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((log) => (
        <div
          key={log._id}
          className={`flex ${log.direction === "inbound" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[82%] ${log.direction === "inbound" ? "items-end" : "items-start"} flex flex-col`}
          >
            <div className="mb-1 flex items-center gap-2 text-label text-muted-foreground/40">
              <span>{log.direction === "inbound" ? "Prospect" : "Glass"}</span>
              <span>{dayjs(log.createdAt).format("MMM D, h:mm A")}</span>
            </div>
            <div
              className={`rounded-lg px-3.5 py-2.5 text-base leading-6 ${
                log.direction === "inbound"
                  ? "bg-foreground text-background"
                  : "border border-foreground/6 bg-popover text-foreground"
              }`}
            >
              {log.subject ? (
                <p className="mb-1 font-medium">{log.subject}</p>
              ) : null}
              <p className="whitespace-pre-wrap">{log.content}</p>
            </div>
          </div>
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
  const selectedTranscript = transcriptDetail?.transcript as
    | TranscriptRow
    | undefined;

  const rightPanel = (
    <SettingsDrawer
      open={Boolean(selectedTranscriptId)}
      onOpenChange={(open) => {
        if (!open) setSelectedTranscriptId(null);
      }}
      title={drawerTitle(selectedTranscript)}
    >
      {transcriptDetail ? (
        <div className="pb-4">
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
              return (
                <ActionSurfaceButton
                  key={row._id}
                  className="group flex w-full items-center gap-3 px-4 py-3"
                  onClick={() => setSelectedTranscriptId(row._id)}
                >
                  <div className="shrink-0 text-muted-foreground/30">
                    {channelIcon(row.channel)}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                    <p className="truncate text-base font-medium text-foreground">
                      {formatContact(row.senderContact)}
                    </p>
                    <p className="shrink-0 text-label text-muted-foreground/40">
                      {formatShortTime(row.lastUpdatedAt)}
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
