import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireOrgAccess } from "./orgAuth";
import { assertBrokerOfClient } from "./orgRelationships";

type Ctx = QueryCtx | MutationCtx;

export async function assertCanCreateApplication(
  ctx: Ctx,
  clientOrgId: Id<"organizations">,
) {
  const access = await requireOrgAccess(ctx);
  await assertBrokerOfClient(ctx, access.orgId, clientOrgId);
  return access;
}

export async function assertCanEditApplicationDraft(
  ctx: Ctx,
  applicationId: Id<"applications">,
) {
  const access = await requireOrgAccess(ctx);
  const app = await (ctx as QueryCtx).db.get(applicationId);
  if (!app) throw new Error("Application not found");
  if (app.brokerOrgId !== access.orgId) throw new Error("Forbidden");
  if (app.status !== "draft") throw new Error("Application is not in draft state");
  return { access, app };
}

export async function assertCanSendApplication(
  ctx: Ctx,
  applicationId: Id<"applications">,
) {
  const access = await requireOrgAccess(ctx);
  const app = await (ctx as QueryCtx).db.get(applicationId);
  if (!app) throw new Error("Application not found");
  if (app.brokerOrgId !== access.orgId) throw new Error("Forbidden");
  if (app.status !== "draft") throw new Error("Can only send draft applications");
  return { access, app };
}

export async function assertCanAnswerApplication(
  ctx: Ctx,
  applicationId: Id<"applications">,
) {
  const access = await requireOrgAccess(ctx);
  const app = await (ctx as QueryCtx).db.get(applicationId);
  if (!app) throw new Error("Application not found");
  if (app.clientOrgId !== access.orgId) throw new Error("Forbidden: client org only");
  if (app.status === "cancelled") throw new Error("Application is cancelled");
  return { access, app };
}

export async function assertCanReviewApplication(
  ctx: Ctx,
  applicationId: Id<"applications">,
) {
  const access = await requireOrgAccess(ctx);
  const app = await (ctx as QueryCtx).db.get(applicationId);
  if (!app) throw new Error("Application not found");
  if (app.brokerOrgId !== access.orgId) throw new Error("Forbidden: broker org only");
  return { access, app };
}

export async function assertCanCreateBrokerTemplate(ctx: Ctx) {
  return await requireOrgAccess(ctx);
}

export async function assertCanUseSystemTemplate(ctx: Ctx) {
  return await requireOrgAccess(ctx);
}
