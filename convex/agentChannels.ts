import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess, requireCurrentOrgAdminWrite } from "./lib/access";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

export const DEFAULT_AGENT_CHANNEL_SETTINGS = {
  emailEnabled: true,
  imessageEnabled: true,
  slackEnabled: false,
  slackSafeAlertsEnabled: true,
  slackVendorAlertsEnabled: false,
  slackPolicyDeliveryEnabled: true,
} as const;

type AgentChannelSettingsInput = {
  emailEnabled: boolean;
  imessageEnabled: boolean;
  slackEnabled: boolean;
  slackSafeAlertsEnabled: boolean;
  slackVendorAlertsEnabled: boolean;
  slackPolicyDeliveryEnabled: boolean;
};

const settingsArgs = {
  emailEnabled: v.boolean(),
  imessageEnabled: v.boolean(),
  slackEnabled: v.boolean(),
  slackSafeAlertsEnabled: v.boolean(),
  slackVendorAlertsEnabled: v.boolean(),
  slackPolicyDeliveryEnabled: v.boolean(),
};

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readSettings(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  const settings = await ctx.db
    .query("agentChannelSettings")
    .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
  return settings ?? { clientOrgId, ...DEFAULT_AGENT_CHANNEL_SETTINGS };
}

async function activeConnection(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  return await ctx.db
    .query("slackWorkspaceConnections")
    .withIndex("by_clientOrgId_and_status", (q) =>
      q.eq("clientOrgId", clientOrgId).eq("status", "active"),
    )
    .first();
}

async function channelOverview(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  const [settings, connection] = await Promise.all([
    readSettings(ctx, clientOrgId),
    activeConnection(ctx, clientOrgId),
  ]);
  const primaryChannel = connection
    ? await ctx.db
        .query("slackChannelBindings")
        .withIndex("by_connectionId_and_status", (q) =>
          q.eq("connectionId", connection._id).eq("status", "active"),
        )
        .first()
    : null;
  return { settings, connection, primaryChannel };
}

async function setupActorKind(
  ctx: QueryCtx,
  clientOrgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) =>
      q.eq("orgId", clientOrgId).eq("userId", userId),
    )
    .first();
  if (membership?.role === "admin") return "client_admin" as const;
  const profile = await ctx.db
    .query("operatorProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return profile?.status === "active" ? ("operator" as const) : null;
}

function settingsInput(settings: AgentChannelSettingsInput): AgentChannelSettingsInput {
  return {
    emailEnabled: settings.emailEnabled,
    imessageEnabled: settings.imessageEnabled,
    slackEnabled: settings.slackEnabled,
    slackSafeAlertsEnabled: settings.slackSafeAlertsEnabled,
    slackVendorAlertsEnabled: settings.slackVendorAlertsEnabled,
    slackPolicyDeliveryEnabled: settings.slackPolicyDeliveryEnabled,
  };
}

async function deactivateConnection(
  ctx: MutationCtx,
  connection: Doc<"slackWorkspaceConnections">,
  status: "disconnected" | "revoked",
  actor: {
    updatedByUserId?: Id<"users">;
    updatedByOperatorUserId?: Id<"users">;
  },
) {
  const now = dayjs().valueOf();
  if (connection.nativeInstallationId) {
    const installation = await ctx.db.get(connection.nativeInstallationId);
    if (installation) {
      await ctx.db.patch(installation._id, {
        status,
        encryptedBotToken: undefined,
        encryptedRefreshToken: undefined,
        botTokenExpiresAt: undefined,
        updatedAt: now,
      });
    }
  }
  await ctx.db.patch(connection._id, {
    status,
    disconnectedAt: now,
    updatedAt: now,
  });
  const bindings = await ctx.db
    .query("slackChannelBindings")
    .withIndex("by_connectionId_and_status", (q) =>
      q.eq("connectionId", connection._id).eq("status", "active"),
    )
    .collect();
  for (const binding of bindings) {
    await ctx.db.patch(binding._id, { status: "archived", updatedAt: now });
  }
  const settings = settingsInput(
    await readSettings(ctx, connection.clientOrgId),
  );
  await upsertSettings(
    ctx,
    connection.clientOrgId,
    { ...settings, slackEnabled: false },
    actor,
  );
}

export const get = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.clientOrgId);
    return await channelOverview(ctx, args.clientOrgId);
  },
});

export const getForOperator = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await channelOverview(ctx, args.clientOrgId);
  },
});

export const update = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdminWrite(ctx);
    if ((access.org.type ?? "client") !== "client") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Slack is owned by the client organization.",
      );
    }
    return await upsertSettings(ctx, access.orgId, args, {
      updatedByUserId: access.userId,
    });
  },
});

export const updateForOperator = mutation({
  args: { clientOrgId: v.id("organizations"), ...settingsArgs },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || (org.type ?? "client") !== "client") {
      throw new Error("Client organization not found");
    }
    const { clientOrgId, ...settings } = args;
    const id = await upsertSettings(ctx, clientOrgId, settings, {
      updatedByOperatorUserId: operator.userId,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: clientOrgId,
      summary: "Updated client agent channel settings",
      metadata: settings,
    });
    return id;
  },
});

export const setOperatorSlackIdentity = mutation({
  args: { teamId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const teamId = args.teamId.trim();
    const slackUserId = args.userId.trim();
    if (!teamId || !slackUserId) throw new Error("Slack team and user IDs are required");
    const collision = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_slackTeamId_and_slackUserId", (q) =>
        q.eq("slackTeamId", teamId).eq("slackUserId", slackUserId),
      )
      .first();
    if (collision && collision._id !== operator.profile._id) {
      throw new Error("This Slack identity belongs to another Glass operator");
    }
    await ctx.db.patch(operator.profile._id, {
      slackTeamId: teamId,
      slackUserId,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: "Connected operator Slack identity",
      metadata: { teamId, slackUserId },
    });
  },
});

async function upsertSettings(
  ctx: MutationCtx,
  clientOrgId: Id<"organizations">,
  settings: AgentChannelSettingsInput,
  actor: {
    updatedByUserId?: Id<"users">;
    updatedByOperatorUserId?: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("agentChannelSettings")
    .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
  const now = dayjs().valueOf();
  if (existing) {
    await ctx.db.patch(existing._id, { ...settings, ...actor, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("agentChannelSettings", {
    clientOrgId,
    ...settings,
    ...actor,
    createdAt: now,
    updatedAt: now,
  });
}

export const authorizeSetup = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || (org.type ?? "client") !== "client") {
      throw new Error("Client organization not found");
    }
    const kind = await setupActorKind(ctx, args.clientOrgId, args.userId);
    if (!kind) throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
    return { kind, org, userId: args.userId };
  },
});

export const createOAuthState = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    userId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    const state = randomState();
    const now = dayjs().valueOf();
    await ctx.db.insert("slackOAuthStates", {
      stateHash: await sha256(state),
      purpose: "customer",
      clientOrgId: args.clientOrgId,
      ...(args.actorKind === "operator"
        ? { initiatedByOperatorUserId: args.userId }
        : { initiatedByUserId: args.userId }),
      expiresAt: dayjs(now).add(10, "minute").valueOf(),
      createdAt: now,
    });
    return state;
  },
});

export const createHostOAuthState = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const state = randomState();
    const now = dayjs().valueOf();
    await ctx.db.insert("slackOAuthStates", {
      stateHash: await sha256(state),
      purpose: "host",
      initiatedByOperatorUserId: args.userId,
      expiresAt: dayjs(now).add(10, "minute").valueOf(),
      createdAt: now,
    });
    return state;
  },
});

export const claimOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const stateHash = await sha256(args.state);
    const row = await ctx.db
      .query("slackOAuthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", stateHash))
      .first();
    const now = dayjs().valueOf();
    if (!row || row.usedAt || row.expiresAt < now) return null;
    await ctx.db.patch(row._id, { usedAt: now });
    return row;
  },
});

async function upsertNativeSlackInstallation(
  ctx: MutationCtx,
  args: {
    teamId: string;
    teamName: string;
    kind: "customer" | "host";
    appId?: string;
    botUserId?: string;
    encryptedBotToken: string;
    encryptedRefreshToken?: string;
    botTokenExpiresAt?: number;
    grantedScopes: string[];
  },
) {
  const active = await ctx.db
    .query("slackInstallations")
    .withIndex("by_teamId_and_status", (q) =>
      q.eq("teamId", args.teamId).eq("status", "active"),
    )
    .first();
  if (active && active.kind !== args.kind) {
    throw new Error("This Slack workspace already has a different Glass role");
  }
  const reusable = active ??
    (await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "disconnected"),
      )
      .first()) ??
    (await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "revoked"),
      )
      .first());
  if (reusable && reusable.kind !== args.kind) {
    throw new Error("This Slack workspace already has a different Glass role");
  }
  const now = dayjs().valueOf();
  if (reusable) {
    await ctx.db.patch(reusable._id, {
      teamName: args.teamName,
      appId: args.appId,
      botUserId: args.botUserId,
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      grantedScopes: args.grantedScopes,
      status: "active",
      updatedAt: now,
    });
    return reusable._id;
  }
  return await ctx.db.insert("slackInstallations", {
    ...args,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

export const upsertSlackConnection = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    teamId: v.string(),
    teamName: v.string(),
    appId: v.optional(v.string()),
    encryptedBotToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
    installedByUserId: v.optional(v.id("users")),
    installedByOperatorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const teamConnection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (teamConnection && teamConnection.clientOrgId !== args.clientOrgId) {
      throw new Error("This Slack workspace is already connected to another client");
    }
    const clientConnection = await activeConnection(ctx, args.clientOrgId);
    if (clientConnection && clientConnection.teamId !== args.teamId) {
      throw new Error("This client already has an active Slack workspace");
    }

    const now = dayjs().valueOf();
    const nativeInstallationId = args.encryptedBotToken
      ? await upsertNativeSlackInstallation(ctx, {
          teamId: args.teamId,
          teamName: args.teamName,
          kind: "customer",
          appId: args.appId,
          botUserId: args.botUserId,
          encryptedBotToken: args.encryptedBotToken,
          encryptedRefreshToken: args.encryptedRefreshToken,
          botTokenExpiresAt: args.botTokenExpiresAt,
          grantedScopes: args.grantedScopes,
        })
      : undefined;
    const reusableConnection =
      clientConnection ??
      (await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("by_clientOrgId_and_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "disconnected"),
        )
        .first()) ??
      (await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("by_clientOrgId_and_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "revoked"),
        )
        .first());
    if (reusableConnection && reusableConnection.teamId !== args.teamId) {
      throw new Error("This client already has a Slack workspace history; disconnect it before changing workspaces");
    }

    let connectionId = reusableConnection?._id;
    if (reusableConnection) {
      await ctx.db.patch(reusableConnection._id, {
        teamName: args.teamName,
        appId: args.appId,
        ...(nativeInstallationId ? { nativeInstallationId } : {}),
        installationId: args.installationId,
        botUserId: args.botUserId,
        grantedScopes: args.grantedScopes,
        status: "active",
        installedByUserId: args.installedByUserId,
        installedByOperatorUserId: args.installedByOperatorUserId,
        thirdPartyVisibilityAcknowledged: true,
        updatedAt: now,
        disconnectedAt: undefined,
      });
    } else {
      const serviceUserId = await ctx.db.insert("users", {
        name: `Glass Slack (${args.teamName})`,
        accountKind: "customer",
        serviceAccountKind: "slack",
        onboardingComplete: true,
      });
      await ctx.db.insert("orgMemberships", {
        orgId: args.clientOrgId,
        userId: serviceUserId,
        role: "admin",
      });
      connectionId = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId: args.clientOrgId,
        teamId: args.teamId,
        teamName: args.teamName,
        appId: args.appId,
        nativeInstallationId,
        installationId: args.installationId,
        botUserId: args.botUserId,
        grantedScopes: args.grantedScopes,
        status: "active",
        serviceUserId,
        installedByUserId: args.installedByUserId,
        installedByOperatorUserId: args.installedByOperatorUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const current = await readSettings(ctx, args.clientOrgId);
    await upsertSettings(
      ctx,
      args.clientOrgId,
      {
        emailEnabled: current.emailEnabled,
        imessageEnabled: current.imessageEnabled,
        slackEnabled: true,
        slackSafeAlertsEnabled: current.slackSafeAlertsEnabled,
        slackVendorAlertsEnabled: current.slackVendorAlertsEnabled,
        slackPolicyDeliveryEnabled: current.slackPolicyDeliveryEnabled,
      },
      {
        updatedByUserId: args.installedByUserId,
        updatedByOperatorUserId: args.installedByOperatorUserId,
      },
    );
    const deliverySettings = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
        q
          .eq("deliveryOwnerOrgId", args.clientOrgId)
          .eq("clientOrgId", args.clientOrgId),
      )
      .first();
    if (!deliverySettings) {
      if (!connectionId) throw new Error("Slack connection was not created");
      const persistedConnection = await ctx.db.get(connectionId);
      if (!persistedConnection) throw new Error("Slack connection was not found");
      await ctx.db.insert("policyDeliverySettings", {
        deliveryOwnerOrgId: args.clientOrgId,
        clientOrgId: args.clientOrgId,
        enabled: true,
        channels: ["slack"],
        defaultAction: "auto_send",
        deliverBeforeClientAcceptance: false,
        updatedByUserId:
          args.installedByUserId ??
          args.installedByOperatorUserId ??
          persistedConnection.serviceUserId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const activeBinding = await ctx.db
      .query("slackChannelBindings")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first();
    const binding =
      activeBinding ??
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("by_clientOrgId_and_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "archived"),
        )
        .first());
    if (binding && connectionId) {
      await ctx.db.patch(binding._id, {
        connectionId,
        status: "active",
        updatedAt: now,
      });
    }
    if (args.installedByOperatorUserId) {
      await writeOperatorAudit(ctx, {
        operatorUserId: args.installedByOperatorUserId,
        type: "setup_write",
        targetOrgId: args.clientOrgId,
        summary: "Installed or refreshed the client Slack workspace connection",
        metadata: { teamId: args.teamId, teamName: args.teamName },
      });
    }
    return connectionId;
  },
});

export const upsertSlackHostInstallation = internalMutation({
  args: {
    teamId: v.string(),
    teamName: v.string(),
    appId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    encryptedBotToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
    grantedScopes: v.array(v.string()),
    installedByOperatorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const installationId = await upsertNativeSlackInstallation(ctx, {
      teamId: args.teamId,
      teamName: args.teamName,
      kind: "host",
      appId: args.appId,
      botUserId: args.botUserId,
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      grantedScopes: args.grantedScopes,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.installedByOperatorUserId,
      type: "setup_write",
      summary: "Installed or refreshed the Clarity Slack host workspace",
      metadata: { teamId: args.teamId, teamName: args.teamName },
    });
    return installationId;
  },
});

export const bindPrimaryChannelForOperator = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    hostTeamId: v.string(),
    hostChannelId: v.string(),
    customerChannelId: v.optional(v.string()),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const connection = await activeConnection(ctx, args.clientOrgId);
    if (!connection) throw new Error("Connect the customer Slack workspace first");
    const existing = await ctx.db
      .query("slackChannelBindings")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first();
    const now = dayjs().valueOf();
    let bindingId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, {
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        customerChannelId: args.customerChannelId,
        channelName: args.channelName,
        updatedAt: now,
      });
    } else {
      bindingId = await ctx.db.insert("slackChannelBindings", {
        connectionId: connection._id,
        clientOrgId: args.clientOrgId,
        kind: "primary",
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        customerChannelId: args.customerChannelId,
        channelName: args.channelName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Set #${args.channelName} as the primary Slack service channel`,
      metadata: {
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        customerChannelId: args.customerChannelId,
      },
    });
    return bindingId;
  },
});

export const bindPrimaryChannelInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.optional(v.id("slackWorkspaceConnections")),
    operatorUserId: v.id("users"),
    hostTeamId: v.string(),
    hostChannelId: v.string(),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackChannelBindings")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first();
    const now = dayjs().valueOf();
    let bindingId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, {
        connectionId: args.connectionId,
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        channelName: args.channelName,
        updatedAt: now,
      });
    } else {
      bindingId = await ctx.db.insert("slackChannelBindings", {
        connectionId: args.connectionId,
        clientOrgId: args.clientOrgId,
        kind: "primary",
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        channelName: args.channelName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Created #${args.channelName} as the primary Slack service channel`,
      metadata: { hostTeamId: args.hostTeamId, hostChannelId: args.hostChannelId },
    });
    return bindingId;
  },
});

export const disconnectInternal = internalMutation({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "active") return null;
    await deactivateConnection(
      ctx,
      connection,
      "disconnected",
      args.actorKind === "operator"
        ? { updatedByOperatorUserId: args.actorUserId }
        : { updatedByUserId: args.actorUserId },
    );
    if (args.actorKind === "operator") {
      await writeOperatorAudit(ctx, {
        operatorUserId: args.actorUserId,
        type: "setup_write",
        targetOrgId: connection.clientOrgId,
        summary: "Disconnected the client Slack workspace",
        metadata: { teamId: connection.teamId },
      });
    }
    return connection;
  },
});

export const getSlackCredentialsByTeamId = internalQuery({
  args: { teamId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first(),
});

export const updateSlackCredentials = internalMutation({
  args: {
    installationId: v.id("slackInstallations"),
    encryptedBotToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation || installation.status !== "active") {
      throw new Error("Slack installation is not active");
    }
    await ctx.db.patch(installation._id, {
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      refreshLeaseExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const claimSlackCredentialRefresh = internalMutation({
  args: { installationId: v.id("slackInstallations") },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation || installation.status !== "active") {
      throw new Error("Slack installation is not active");
    }
    const now = dayjs().valueOf();
    if (
      installation.botTokenExpiresAt &&
      installation.botTokenExpiresAt > dayjs(now).add(5, "minute").valueOf()
    ) {
      return { claimed: false as const, reason: "fresh" as const, installation };
    }
    if (
      installation.refreshLeaseExpiresAt &&
      installation.refreshLeaseExpiresAt > now
    ) {
      return {
        claimed: false as const,
        reason: "in_progress" as const,
        installation,
      };
    }
    await ctx.db.patch(installation._id, {
      refreshLeaseExpiresAt: dayjs(now).add(45, "second").valueOf(),
      updatedAt: now,
    });
    return { claimed: true as const, installation };
  },
});

export const releaseSlackCredentialRefresh = internalMutation({
  args: { installationId: v.id("slackInstallations") },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation) return;
    await ctx.db.patch(installation._id, {
      refreshLeaseExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const getActiveSlackHostInstallation = internalQuery({
  args: {},
  handler: async (ctx) => {
    const teamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (!teamId) return null;
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", teamId).eq("status", "active"),
      )
      .first();
    return installation?.kind === "host" ? installation : null;
  },
});

export const getSlackHostStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const teamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (!teamId) return { configured: false, installation: null };
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", teamId).eq("status", "active"),
      )
      .first();
    return {
      configured: true,
      installation:
        installation?.kind === "host"
          ? {
              teamId: installation.teamId,
              teamName: installation.teamName,
              botUserId: installation.botUserId,
              grantedScopes: installation.grantedScopes,
              updatedAt: installation.updatedAt,
            }
          : null,
    };
  },
});

export const revokeByTeamId = internalMutation({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (installation) {
      await ctx.db.patch(installation._id, {
        status: "revoked",
        encryptedBotToken: undefined,
        encryptedRefreshToken: undefined,
        botTokenExpiresAt: undefined,
        updatedAt: dayjs().valueOf(),
      });
    }
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (!connection) return installation?._id ?? null;
    await deactivateConnection(ctx, connection, "revoked", {});
    return connection._id;
  },
});

export const authorizeDisconnect = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || (org.type ?? "client") !== "client") {
      throw new Error("Client organization not found");
    }
    const actorKind = await setupActorKind(ctx, args.clientOrgId, args.userId);
    if (!actorKind) throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
    const connection = await activeConnection(ctx, args.clientOrgId);
    if (!connection) return null;
    return { actorKind, connection };
  },
});

export const authorizeSlackHostSetup = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return profile?.status === "active";
  },
});
