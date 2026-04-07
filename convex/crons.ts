import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "check stale application sessions",
  { minutes: 2 },
  internal.applicationSessions.checkStaleAndFail,
);

export default crons;
