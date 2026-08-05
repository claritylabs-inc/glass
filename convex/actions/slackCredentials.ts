"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { resolveSlackInstallation } from "../lib/slackCredentials";

export const resolveInstallation = internalAction({
  args: { teamId: v.string() },
  handler: async (ctx, args) =>
    await resolveSlackInstallation(ctx, args.teamId.trim()),
});
