import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// applicationSessions retired — cron removed

crons.daily(
  "daily email scan",
  { hourUTC: 9, minuteUTC: 0 },
  internal.actions.dailyScan.runDailyScan,
);

crons.weekly(
  "weekly dream consolidation",
  { dayOfWeek: "sunday", hourUTC: 10, minuteUTC: 0 },
  internal.actions.dreamConsolidation.runDreamForAllOrgs,
);

// Sweep stale info-level notifications every Sunday at 03:00 UTC
crons.cron(
  "sweep stale info notifications",
  "0 3 * * 0",
  (internal as any).notifications.sweepStale,
  {},
);

// Daily integration sync — jittered per-connection inside the action
crons.daily(
  "daily integration sync",
  { hourUTC: 6, minuteUTC: 30 },
  (internal as any).actions.mergeSync.scheduledSyncAll,
  {},
);

export default crons;
