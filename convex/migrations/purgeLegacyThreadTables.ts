import { internalMutation } from "../_generated/server";

const LEGACY_TABLES = ["webChatMessages", "webChats", "agentConversations"] as const;
const DEPRECATED_NOTIFICATION_TYPES = new Set([
  "dream_insight",
  "application_submitted_by_client",
  "application_completed_by_client",
  "application_sent_by_broker",
  "application_section_returned_by_broker",
  "application_accepted_by_broker",
  "integration_disconnected_for_client",
  "integration_request_fulfilled",
  "integration_requested_by_broker",
  "passport_flag_resolved_by_client",
  "passport_flag_raised_by_broker",
]);

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of LEGACY_TABLES) {
      const rows = await (ctx.db.query as any)(table).collect();
      counts[table] = rows.length;
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }
    const notifications = await ctx.db.query("notifications").collect();
    counts.deprecatedNotifications = 0;
    for (const notification of notifications) {
      if (DEPRECATED_NOTIFICATION_TYPES.has(notification.type)) {
        await ctx.db.delete(notification._id);
        counts.deprecatedNotifications++;
      }
    }

    const preferences = await ctx.db.query("notificationPreferences").collect();
    counts.deprecatedNotificationPreferences = 0;
    for (const preference of preferences) {
      if (DEPRECATED_NOTIFICATION_TYPES.has(preference.type)) {
        await ctx.db.delete(preference._id);
        counts.deprecatedNotificationPreferences++;
      }
    }

    const orgs = await ctx.db.query("organizations").collect();
    counts.deprecatedOrgFields = 0;
    for (const org of orgs) {
      if (
        "portfolioAnalysis" in org ||
        "intelligenceSummary" in org ||
        "lastDreamAt" in org
      ) {
        await (ctx.db.patch as any)(org._id, {
          portfolioAnalysis: undefined,
          intelligenceSummary: undefined,
          lastDreamAt: undefined,
        });
        counts.deprecatedOrgFields++;
      }
    }
    return counts;
  },
});
