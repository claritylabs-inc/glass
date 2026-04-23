import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep stale info-level notifications every Sunday at 03:00 UTC
crons.cron(
  "sweep stale info notifications",
  "0 3 * * 0",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).notifications.sweepStale,
  {},
);

export default crons;
