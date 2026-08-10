"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { FormSection } from "@/components/ui/form-section";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function SlackConnectionFields({
  clientOrgId,
  currentChannelId,
  knownChannels,
  canEdit,
}: {
  clientOrgId: Id<"organizations">;
  currentChannelId?: string;
  knownChannels: Array<{
    channelId: string;
    channelName: string;
    isPrivate: boolean;
    isShared: boolean;
  }>;
  canEdit: boolean;
}) {
  const listChannels = useAction(
    api.actions.slackOnboarding.listAvailableChannels,
  );
  const selectChannel = useAction(
    api.actions.slackOnboarding.selectAutomaticChannel,
  );
  const joinPublicChannel = useAction(
    api.actions.slackOnboarding.joinPublicChannel,
  );
  const [channels, setChannels] = useState(
    knownChannels.map((channel) => ({
      id: channel.channelId,
      name: channel.channelName,
      isMember: true,
      isPrivate: channel.isPrivate,
      isShared: channel.isShared,
    })),
  );
  const [selectedChannelId, setSelectedChannelId] = useState(
    currentChannelId ?? "",
  );
  const [channelToAdd, setChannelToAdd] = useState("");
  const [loading, setLoading] = useState(canEdit);
  const [loadError, setLoadError] = useState(false);
  const [joining, setJoining] = useState(false);
  const joinedChannels = channels.filter((channel) => channel.isMember);
  const publicChannelsToAdd = channels.filter(
    (channel) => !channel.isMember && !channel.isPrivate && !channel.isShared,
  );
  const selectedChannelToAdd = publicChannelsToAdd.find(
    (channel) => channel.id === channelToAdd,
  );
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId && channel.isMember,
  );
  const autoSave = useLocalFirstAutoSave({
    mutationName: `client.slackChannel.select.${clientOrgId}`,
    args: { clientOrgId, channelId: selectedChannelId },
    valueKey: selectedChannelId,
    resetKey: `${clientOrgId}:${currentChannelId ?? "unselected"}`,
    enabled: canEdit,
    canSave: Boolean(selectedChannelId && selectedChannel),
    delayMs: 0,
    flush: selectChannel,
    onFlushed: (result) => {
      if (!result) return;
      setChannels((current) =>
        current.some((channel) => channel.id === result.id)
          ? current
          : [...current, result],
      );
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Slack channel could not be changed"),
  });

  const loadChannels = useCallback(async () => {
    if (!canEdit) return;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await listChannels({ clientOrgId });
      setChannels(result.channels);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [canEdit, clientOrgId, listChannels]);

  useEffect(() => {
    if (!canEdit) return;
    const timeout = window.setTimeout(() => void loadChannels(), 0);
    return () => window.clearTimeout(timeout);
  }, [canEdit, loadChannels]);

  async function addChannel() {
    if (!channelToAdd) return;
    setJoining(true);
    try {
      const result = await joinPublicChannel({
        clientOrgId,
        channelId: channelToAdd,
      });
      setChannels(result.channels);
      setChannelToAdd("");
      toast.success(`Glass added to #${result.channel.name}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Glass could not be added to the channel",
        ),
      );
    } finally {
      setJoining(false);
    }
  }

  return (
    <FormSection
      title="Channels"
      description="Glass responds to mentions and active threads in each connected channel."
      divided={false}
      action={
        canEdit ? (
          <PillButton
            variant="secondary"
            size="compact"
            onClick={() => void loadChannels()}
            disabled={loading || joining}
          >
            <RefreshCw
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
            Refresh
          </PillButton>
        ) : null
      }
    >
      <div className="space-y-4">
        {canEdit && selectedChannelId ? (
          <AutoSaveStatus status={autoSave.status} />
        ) : null}
        <div className="space-y-2">
          {joinedChannels.length > 0 ? (
            <div className="divide-y divide-foreground/6 rounded-lg border border-foreground/6 bg-popover px-3">
              {joinedChannels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base text-foreground">
                      #{channel.name}
                    </p>
                    {channel.isShared || channel.isPrivate ? (
                      <p className="text-label text-muted-foreground">
                        {channel.isShared ? "Slack Connect" : "Private channel"}
                      </p>
                    ) : null}
                  </div>
                  {channel.id === selectedChannelId ? (
                    <StatusTag tone="success">Automatic</StatusTag>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-base text-muted-foreground">
              No channels connected yet.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="slack-channel-name"
            className="text-label text-muted-foreground"
          >
            Default for automatic messages
          </label>
          <Select
            value={selectedChannelId || null}
            onValueChange={(nextChannelId) => {
              if (typeof nextChannelId === "string") {
                setSelectedChannelId(nextChannelId);
              }
            }}
            disabled={!canEdit || loading || joinedChannels.length === 0}
          >
            <SelectTrigger id="slack-channel-name" className="w-full">
              <SelectValue>
                {selectedChannel
                  ? `#${selectedChannel.name}`
                  : "Select channel"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {joinedChannels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loadError ? (
            <p className="text-label text-destructive">
              Slack channels could not be loaded.
            </p>
          ) : (
            <p className="text-label text-muted-foreground">
              Alerts and document deliveries go to this channel.
            </p>
          )}
        </div>
        {canEdit && publicChannelsToAdd.length > 0 ? (
          <div className="space-y-1.5">
            <label
              htmlFor="slack-channel-add"
              className="text-label text-muted-foreground"
            >
              Add Glass to a public channel
            </label>
            <div className="flex items-center gap-2">
              <Select
                value={channelToAdd || null}
                onValueChange={(value) => {
                  if (typeof value === "string") setChannelToAdd(value);
                }}
                disabled={loading || joining}
              >
                <SelectTrigger
                  id="slack-channel-add"
                  className="min-w-0 flex-1"
                >
                  <SelectValue>
                    {selectedChannelToAdd
                      ? `#${selectedChannelToAdd.name}`
                      : "Select channel"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {publicChannelsToAdd.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      #{channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PillButton
                onClick={() => void addChannel()}
                disabled={!channelToAdd || joining}
              >
                {joining ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Add
              </PillButton>
            </div>
          </div>
        ) : null}
        {canEdit ? (
          <p className="text-label text-muted-foreground">
            For private or Slack Connect channels, add @Glass in Slack, then
            refresh this list.
          </p>
        ) : null}
      </div>
    </FormSection>
  );
}
