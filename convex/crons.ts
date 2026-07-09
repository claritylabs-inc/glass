import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep stale info-level notifications every Sunday at 03:00 UTC
crons.cron(
  "sweep stale info notifications",
  "0 3 * * 0",

  internal.notifications.sweepStale,
  {},
);

crons.cron(
  "monitor vendor compliance",
  "0 14 * * *",
  internal.actions.vendorComplianceMonitor.run,
  {},
);

crons.cron(
  "monitor own insurance compliance",
  "15 14 * * *",
  internal.actions.ownComplianceMonitor.run,
  {},
);

crons.interval(
  "sweep stale policy extractions",
  { minutes: 5 },
  internal.actions.policyExtraction.sweepStale,
  {},
);

crons.cron(
  "sweep extraction traces",
  "30 3 * * *",
  internal.extractionTraces.sweepExpired,
  {},
);

export default crons;
