import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "check stale application sessions",
  { minutes: 2 },
  internal.applicationSessions.checkStaleAndFail,
);

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

export default crons;
