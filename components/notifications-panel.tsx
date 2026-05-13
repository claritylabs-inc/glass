"use client";

import { useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  GitMerge,
  ShieldAlert,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingDown,
  TrendingUp,
  Bell,
  X,
  FileText,
  FileCheck,
  UserCheck,
  UserPlus,
} from "lucide-react";

dayjs.extend(relativeTime);

type NotificationType =
  | "merge_suggestion"
  | "coverage_gap"
  | "renewal_reminder"
  | "policy_lapsed"
  | "coverage_limit_concern"
  | "missing_coverage"
  | "carrier_rating_change"
  | "broker_action"
  | "extraction_complete"
  | "extraction_error"
  | "incomplete_extraction"
  | "stale_data"
  | "premium_anomaly"
  | "client_invitation_accepted"
  | "client_onboarding_completed"
  | "client_document_uploaded"
  | "policy_delivered_by_broker"
  | "quote_delivered_by_broker"
  | "vendor_compliance_met"
  | "vendor_compliance_gap"
  | "vendor_policy_expiring"
  | "vendor_policy_expired";

interface Notification {
  _id: Id<"notifications">;
  type: NotificationType;
  title: string;
  body: string;
  status: "unread" | "read" | "actioned" | "dismissed";
  createdAt: number;
  actionType?: string;
  actionPayload?: unknown;
  sourceRef?: unknown;
  relatedOrgId?: Id<"organizations">;
  relatedOrgName?: string;
  coalescedCount?: number;
}

const TYPE_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  merge_suggestion: GitMerge,
  coverage_gap: ShieldAlert,
  renewal_reminder: Clock,
  policy_lapsed: AlertTriangle,
  coverage_limit_concern: ShieldAlert,
  missing_coverage: ShieldAlert,
  carrier_rating_change: TrendingDown,
  broker_action: Bell,
  extraction_complete: CheckCircle,
  extraction_error: XCircle,
  incomplete_extraction: XCircle,
  stale_data: Clock,
  premium_anomaly: TrendingUp,
  client_invitation_accepted: UserPlus,
  client_onboarding_completed: UserCheck,
  client_document_uploaded: FileText,
  policy_delivered_by_broker: FileCheck,
  quote_delivered_by_broker: FileCheck,
  vendor_compliance_met: CheckCircle,
  vendor_compliance_gap: ShieldAlert,
  vendor_policy_expiring: Clock,
  vendor_policy_expired: AlertTriangle,
};

interface NotificationsPanelProps {
  orgId: Id<"organizations">;
  onClose: () => void;
  onMergeSuggestion?: (payload: { primaryPolicyId: string; secondaryPolicyId: string }) => void;
}

export function NotificationsPanel({ orgId, onClose, onMergeSuggestion }: NotificationsPanelProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _api = api as any;
  const router = useRouter();
  const notifications = useQuery(_api.notifications.listInbox, { orgId }) as
    | (Notification & { relatedOrgName?: string })[]
    | undefined;
  const markRead = useMutation(_api.notifications.markRead);
  const markAllRead = useMutation(_api.notifications.markAllRead);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleNotificationClick(notification: Notification) {
    if (notification.status === "unread") {
      await markRead({ ids: [notification._id] });
    }

    // Deep link navigation
    if (notification.actionType && notification.actionPayload) {
      const p = notification.actionPayload as Record<string, string>;
      switch (notification.actionType) {
        case "view_policy":
          router.push(`/policies/${p.policyId}`);
          break;
        case "view_thread":
          router.push(`/agent/thread/${p.threadId}`);
          break;
        case "view_vendor_compliance":
          router.push("/connect/vendors");
          break;
        default:
          break;
      }
      onClose();
      return;
    }

    // Legacy merge_suggestion
    if (
      notification.type === "merge_suggestion" &&
      notification.actionPayload &&
      onMergeSuggestion
    ) {
      const payload = notification.actionPayload as {
        primaryPolicyId: string;
        secondaryPolicyId: string;
      };
      onMergeSuggestion(payload);
      onClose();
    }
  }

  const visibleNotifications = (notifications ?? []).filter(
    (n: Notification) => n.status !== "dismissed"
  );

  return (
    <div
      ref={panelRef}
      className="absolute left-2 right-2 top-full mt-2 z-50 min-w-[18rem] overflow-hidden rounded-lg border border-foreground/10 bg-background shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-foreground/6">
        <span className="text-body-sm font-medium text-foreground">Notifications</span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="max-h-[400px] overflow-y-auto">
        {notifications === undefined ? (
          <div className="px-3 py-6 text-center text-body-sm text-muted-foreground/40">
            Loading...
          </div>
        ) : visibleNotifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-body-sm text-muted-foreground/40">
            No notifications
          </div>
        ) : (
          visibleNotifications.map((notification: Notification) => {
            const TypeIcon = TYPE_ICONS[notification.type as NotificationType] ?? Bell;
            const isUnread = notification.status === "unread";
            const isClickable =
              !!(notification.actionType && notification.actionPayload) ||
              (notification.type === "merge_suggestion" && !!notification.actionPayload);

            return (
              <button
                key={notification._id}
                type="button"
                onClick={() => handleNotificationClick(notification as Notification)}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-foreground/[0.04] transition-colors ${
                  isClickable
                    ? "hover:bg-foreground/[0.04] cursor-pointer"
                    : "cursor-default"
                } ${isUnread ? "bg-foreground/[0.02]" : ""}`}
              >
                <TypeIcon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-body-sm text-foreground truncate">{notification.title}</p>
                    {(notification.coalescedCount ?? 1) > 1 && (
                      <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-medium bg-foreground/[0.08] text-muted-foreground">
                        ×{notification.coalescedCount}
                      </span>
                    )}
                  </div>
                  {notification.relatedOrgName && (
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5">{notification.relatedOrgName}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-2">
                    {notification.body}
                  </p>
                  <p className="text-[11px] text-muted-foreground/40 mt-1">
                    {dayjs(notification.createdAt).fromNow()}
                  </p>
                </div>
                {isUnread && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      {visibleNotifications.length > 0 && (
        <div className="px-3 py-2 border-t border-foreground/6">
          <button
            type="button"
            onClick={() => markAllRead({ orgId })}
            className="text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Mark all as read
          </button>
        </div>
      )}
    </div>
  );
}
