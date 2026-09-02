import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const internalApi = internal as any;

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

crons.interval(
  "reconcile Slack installation and channel health",
  { minutes: 15 },
  internalApi.actions.slackReconciliation.runDue,
  {},
);

crons.interval(
  "retry response rating signals",
  { minutes: 10 },
  internalApi.actions.agentResponseFeedback.retryPending,
  {},
);

crons.cron(
  "sweep extraction traces",
  "30 3 * * *",
  internal.extractionTraces.sweepExpired,
  {},
);

crons.cron(
  "sweep model routing events",
  "45 3 * * *",
  internal.modelRoutingEvents.sweepExpired,
  {},
);

crons.cron(
  "sweep requirement extraction runs",
  "50 3 * * *",
  internalApi.requirementExtractionRuns.sweepExpired,
  {},
);

crons.cron(
  "sweep email draft review links",
  "0 4 * * *",
  internalApi.emailDraftReviewLinks.sweepExpired,
  {},
);

crons.cron(
  "sweep procurement packet links",
  "15 4 * * *",
  internalApi.procurementPacket.sweepExpired,
  {},
);

export default crons;
