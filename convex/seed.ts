import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { normalizeUserPhone } from "./lib/userPhone";

const LOCAL_FIXTURE = {
  operator: {
    email: "terry@claritylabs.inc",
    name: "Terry Wang",
  },
  broker: {
    name: "Montgomery Risk",
    slug: "montgomery-risk",
    website: "https://montgomeryrisk.com",
    agentHandle: "montgomeryrisk",
    admin: {
      email: "terry@montgomeryrisk.com",
      name: "Terry Wang",
    },
  },
  client: {
    name: "Cove",
    website: "https://cove.dev",
    industry: "technology",
    industryVertical: "fintech",
    agentHandle: "cove",
    context:
      "Cove builds underwriting tools for the relationship-based parts of the housing and finance ecosystem. It works with realtors, property managers, brokers, and mortgage agents. Cove is a technology company focused on underwriting and credit products.",
    admin: {
      email: "adyan@cove.dev",
      name: "Adyan Tanver",
    },
  },
  policy: {
    carrier: "Northwoods Continental Insurance Company",
    broker: "Montgomery Risk",
    policyNumber: "NWC-TEC-3110-26-01",
    linesOfBusiness: ["EO", "CYBER"],
    policyYear: 2026,
    effectiveDate: "03/15/2026",
    expirationDate: "03/15/2027",
    insuredName: "Cove Technologies Inc.",
    insuredAddress: {
      street1: "111 Richmond Street West",
      street2: "Suite 700",
      city: "Toronto",
      state: "ON",
      zip: "M5H 2G4",
      country: "Canada",
    },
    operationsDescription:
      "Technology company providing underwriting, credit, and workflow software for housing and finance professionals.",
    producer: {
      agencyName: "Montgomery Risk",
      address: {
        street1: "161 Bay Street",
        street2: "Suite 2700",
        city: "Toronto",
        state: "ON",
        zip: "M5J 2S1",
        country: "Canada",
      },
    },
    insurer: {
      legalName: "Northwoods Continental Insurance Company",
      address: {
        street1: "200 Front Street West",
        city: "Toronto",
        state: "ON",
        zip: "M5V 3J1",
        country: "Canada",
      },
    },
    generalAgent: {
      agencyName: "Highland Risk Services",
      address: {
        street1: "100 King Street West",
        city: "Toronto",
        state: "ON",
        zip: "M5X 1A9",
        country: "Canada",
      },
    },
    premium: "$48,200",
    premiumAmount: 48_200,
    summary:
      "Northwoods Continental Insurance Company policy #NWC-TEC-3110-26-01 for Cove Technologies Inc. covering Errors & Omissions, Other Liability",
    coverages: [
      {
        name: "Technology Errors & Omissions Liability",
        lineOfBusiness: "EO",
        limit: "$5,000,000",
      },
      {
        name: "Network Security & Privacy Liability (Cyber)",
        lineOfBusiness: "OLIB",
        limit: "$3,000,000",
      },
      {
        name: "Media Content Liability",
        limit: "$1,000,000",
      },
    ],
  },
} as const;

const DEFAULT_BROKER_PHONE = "+16472921666";
const DEFAULT_CLIENT_PHONE = "+12025550102";
const DEFAULT_OPERATOR_PHONE = "+12025550100";
const LOCAL_SLACK_FIXTURE = {
  clarityTeamId: "T-CLARITY-FIXTURE",
  operatorUserId: "U-SPOT-OPERATOR",
  customerTeamId: "T-COVE-FIXTURE",
  botUserId: "U-SPOT",
  channelId: "C-COVE-FIXTURE",
  channelName: "spot-cove",
} as const;

type LocalFixtureResult = {
  operatorUserId: Id<"users">;
  brokerUserId: Id<"users">;
  clientUserId: Id<"users">;
  brokerOrgId: Id<"organizations">;
  clientOrgId: Id<"organizations">;
  policyId: Id<"policies">;
  brokerPhone: string;
  clientPhone: string;
  operatorPhone: string;
  summary: string;
};

type LegacyDemoCleanupResult = {
  dryRun: boolean;
  organizations: number;
  memberships: number;
  assignments: number;
  users: number;
};

type VerificationCleanupResult = {
  chats: number;
  events: number;
  participants: number;
  threads: number;
  messages: number;
  publicConversations: number;
  publicLogs: number;
  publicTranscripts: number;
};

function assertLocalSeed() {
  if (process.env.SPOT_ENV !== "local") {
    throw new Error("seed:seed is restricted to SPOT_ENV=local");
  }
}

function fixturePhones(args: {
  brokerPhone?: string;
  clientPhone?: string;
  operatorPhone?: string;
}) {
  const rawBrokerPhone =
    args.brokerPhone?.trim() ||
    process.env.IMESSAGE_TERMINAL_BROKER_PHONE?.trim() ||
    DEFAULT_BROKER_PHONE;
  const rawClientPhone =
    args.clientPhone?.trim() ||
    process.env.IMESSAGE_TERMINAL_CLIENT_PHONE?.trim() ||
    DEFAULT_CLIENT_PHONE;
  const rawOperatorPhone =
    args.operatorPhone?.trim() ||
    process.env.OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE?.trim() ||
    DEFAULT_OPERATOR_PHONE;
  const normalizedPhones = [
    ["brokerPhone", rawBrokerPhone],
    ["clientPhone", rawClientPhone],
    ["operatorPhone", rawOperatorPhone],
  ] as const;
  const phones = normalizedPhones.map(([label, phone]) => {
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error(`${label} must be a valid E.164 phone number`);
    }
    try {
      return normalizeUserPhone(phone)!;
    } catch {
      throw new Error(`${label} must be a valid E.164 phone number`);
    }
  });
  const [brokerPhone, clientPhone, operatorPhone] = phones;
  if (new Set(phones).size !== phones.length) {
    throw new Error(
      "brokerPhone, clientPhone, and operatorPhone must be unique",
    );
  }
  return { brokerPhone, clientPhone, operatorPhone };
}

async function upsertUser(
  ctx: MutationCtx,
  args: {
    email: string;
    name: string;
    accountKind: "customer" | "operator";
    now: number;
    phone?: string;
    legacyEmails?: readonly string[];
  },
) {
  const email = args.email.trim().toLowerCase();
  let existing = await ctx.db
    .query("users")
    .withIndex("email", (query) => query.eq("email", email))
    .first();
  for (const legacyEmail of args.legacyEmails ?? []) {
    if (existing) break;
    existing = await ctx.db
      .query("users")
      .withIndex("email", (query) => query.eq("email", legacyEmail))
      .first();
  }
  if (args.phone) {
    const phoneOwner = await ctx.db
      .query("users")
      .withIndex("phone", (query) => query.eq("phone", args.phone))
      .first();
    if (phoneOwner && phoneOwner._id !== existing?._id) {
      throw new Error(
        `${args.phone} is already assigned to ${phoneOwner.email ?? phoneOwner._id}`,
      );
    }
  }
  const fields = {
    email,
    name: args.name,
    accountKind: args.accountKind,
    onboardingComplete: true,
    emailVerificationTime: existing?.emailVerificationTime ?? args.now,
    ...(args.phone ? { phone: args.phone } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }
  return await ctx.db.insert("users", fields);
}

async function ensureMembership(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const existing = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (query) =>
      query.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { role: "admin" });
    return existing._id;
  }
  return await ctx.db.insert("orgMemberships", {
    orgId,
    userId,
    role: "admin",
  });
}

export const seed = action({
  args: {
    brokerPhone: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    operatorPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LocalFixtureResult> => {
    assertLocalSeed();
    const phones = fixturePhones(args);
    await ctx.runMutation(internal.seed.removeLegacyDemoFixture, {
      dryRun: false,
    });
    const fixture = await ctx.runMutation(
      internal.seed.insertLocalFixture,
      phones,
    );
    const connectionId = await ctx.runMutation(
      internal.agentChannels.upsertSlackConnection,
      {
        clientOrgId: fixture.clientOrgId,
        teamId: LOCAL_SLACK_FIXTURE.customerTeamId,
        teamName: `${LOCAL_FIXTURE.client.name} local fixture`,
        botUserId: LOCAL_SLACK_FIXTURE.botUserId,
        grantedScopes: [
          "app_mentions:read",
          "chat:write",
          "channels:read",
          "channels:history",
          "groups:read",
          "groups:history",
          "files:read",
          "files:write",
          "reactions:write",
          "users:read",
        ],
        installedByOperatorUserId: fixture.operatorUserId,
      },
    );
    if (!connectionId) throw new Error("Could not seed the local Slack connection");
    await ctx.runMutation(internal.agentChannels.bindPrimaryChannelInternal, {
      clientOrgId: fixture.clientOrgId,
      connectionId,
      operatorUserId: fixture.operatorUserId,
      hostTeamId: LOCAL_SLACK_FIXTURE.clarityTeamId,
      hostChannelId: LOCAL_SLACK_FIXTURE.channelId,
      channelName: LOCAL_SLACK_FIXTURE.channelName,
    });
    const brokerLogo = await ctx.runAction(
      internal.actions.extractCompanyInfo.importOrgLogoForOrgInternal,
      {
        orgId: fixture.brokerOrgId,
        url: LOCAL_FIXTURE.broker.website,
      },
    );
    const clientLogo = await ctx.runAction(
      internal.actions.extractCompanyInfo.importOrgLogoForOrgInternal,
      {
        orgId: fixture.clientOrgId,
        url: LOCAL_FIXTURE.client.website,
      },
    );
    const missingLogos = [
      brokerLogo.success ? null : LOCAL_FIXTURE.broker.name,
      clientLogo.success ? null : LOCAL_FIXTURE.client.name,
    ].filter((name) => name !== null);
    if (missingLogos.length > 0) {
      throw new Error(
        `Could not seed stored favicon logos for ${missingLogos.join(" and ")}`,
      );
    }
    return fixture;
  },
});

export const cleanupLegacyDemoFixture = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<LegacyDemoCleanupResult> => {
    assertLocalSeed();
    return await ctx.runMutation(internal.seed.removeLegacyDemoFixture, {
      dryRun: args.dryRun ?? true,
    });
  },
});

export const cleanupLocalVerificationArtifacts = action({
  args: {},
  handler: async (ctx): Promise<VerificationCleanupResult> => {
    assertLocalSeed();
    return await ctx.runMutation(
      internal.seed.removeLocalVerificationArtifacts,
      {},
    );
  },
});

export const removeLocalVerificationArtifacts = internalMutation({
  args: {},
  handler: async (ctx): Promise<VerificationCleanupResult> => {
    const isVerificationGuid = (value: string | undefined) =>
      value?.startsWith("seed-e2e-") === true;
    const chats = (await ctx.db.query("imessageChats").collect()).filter(
      (row) => isVerificationGuid(row.chatGuid),
    );
    const events = (await ctx.db.query("imessageInboundEvents").collect()).filter(
      (row) => isVerificationGuid(row.chatGuid),
    );
    const participants = (
      await ctx.db.query("imessageParticipants").collect()
    ).filter((row) => isVerificationGuid(row.chatGuid));
    const threads = (await ctx.db.query("threads").collect()).filter((row) =>
      isVerificationGuid(row.imessageChatGuid),
    );
    const threadIds = new Set(threads.map(({ _id }) => String(_id)));
    const messages = (await ctx.db.query("threadMessages").collect()).filter(
      (row) => threadIds.has(String(row.threadId)),
    );

    const initialPublicLogs = (
      await ctx.db.query("publicDemoChatLogs").collect()
    ).filter((row) =>
      isVerificationGuid(
        (row.metadata as { chatGuid?: string } | undefined)?.chatGuid,
      ),
    );
    const publicConversationIds = new Set(
      initialPublicLogs.map(({ conversationId }) => String(conversationId)),
    );
    const publicLogs = (
      await ctx.db.query("publicDemoChatLogs").collect()
    ).filter((row) => publicConversationIds.has(String(row.conversationId)));
    const publicConversations = (
      await ctx.db.query("publicDemoConversations").collect()
    ).filter((row) => publicConversationIds.has(String(row._id)));
    const publicTranscripts = (
      await ctx.db.query("publicDemoSalesTranscripts").collect()
    ).filter((row) => publicConversationIds.has(String(row.conversationId)));

    for (const row of messages) await ctx.db.delete(row._id);
    for (const row of threads) await ctx.db.delete(row._id);
    for (const row of participants) await ctx.db.delete(row._id);
    for (const row of chats) await ctx.db.delete(row._id);
    for (const row of events) await ctx.db.delete(row._id);
    for (const row of publicLogs) await ctx.db.delete(row._id);
    for (const row of publicTranscripts) await ctx.db.delete(row._id);
    for (const row of publicConversations) await ctx.db.delete(row._id);

    return {
      chats: chats.length,
      events: events.length,
      participants: participants.length,
      threads: threads.length,
      messages: messages.length,
      publicConversations: publicConversations.length,
      publicLogs: publicLogs.length,
      publicTranscripts: publicTranscripts.length,
    };
  },
});

export const removeLegacyDemoFixture = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args): Promise<LegacyDemoCleanupResult> => {
    const organizations = (await ctx.db.query("organizations").collect()).filter(
      (organization) =>
        organization.name.startsWith("[DEMO]") ||
        organization.slug?.startsWith("demo-"),
    );
    const organizationIds = new Set(organizations.map(({ _id }) => String(_id)));
    const policies = (await ctx.db.query("policies").collect()).filter(
      (policy) => policy.orgId && organizationIds.has(String(policy.orgId)),
    );
    if (policies.length > 0) {
      throw new Error(
        `Refusing to remove legacy demo organizations with ${policies.length} attached policies`,
      );
    }

    const memberships = (await ctx.db.query("orgMemberships").collect()).filter(
      (membership) => organizationIds.has(String(membership.orgId)),
    );
    const assignments = (
      await ctx.db.query("brokerClientAssignments").collect()
    ).filter(
      (assignment) =>
        (assignment.orgId && organizationIds.has(String(assignment.orgId))) ||
        organizationIds.has(String(assignment.clientOrgId)),
    );
    const candidateUserIds = new Set(
      memberships.map(({ userId }) => String(userId)),
    );
    const authAccounts = await ctx.db.query("authAccounts").collect();
    const users = (await ctx.db.query("users").collect()).filter(
      (user) =>
        candidateUserIds.has(String(user._id)) &&
        user.email?.endsWith("@demo.spot") &&
        !authAccounts.some((account) => account.userId === user._id),
    );

    const result = {
      dryRun: args.dryRun,
      organizations: organizations.length,
      memberships: memberships.length,
      assignments: assignments.length,
      users: users.length,
    };
    if (args.dryRun) return result;

    for (const assignment of assignments) await ctx.db.delete(assignment._id);
    for (const membership of memberships) await ctx.db.delete(membership._id);
    for (const organization of organizations) await ctx.db.delete(organization._id);
    for (const user of users) {
      const remainingMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (query) => query.eq("userId", user._id))
        .first();
      if (!remainingMembership) await ctx.db.delete(user._id);
    }
    return result;
  },
});

export const insertLocalFixture = internalMutation({
  args: {
    brokerPhone: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    operatorPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const { brokerPhone, clientPhone, operatorPhone } = fixturePhones(args);
    const operatorUserId = await upsertUser(ctx, {
      ...LOCAL_FIXTURE.operator,
      accountKind: "operator",
      now,
      phone: operatorPhone,
    });
    const operatorProfile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (query) => query.eq("userId", operatorUserId))
      .first();
    if (operatorProfile) {
      await ctx.db.patch(operatorProfile._id, {
        email: LOCAL_FIXTURE.operator.email,
        role: "operator",
        status: "active",
        slackTeamId: LOCAL_SLACK_FIXTURE.clarityTeamId,
        slackUserId: LOCAL_SLACK_FIXTURE.operatorUserId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: LOCAL_FIXTURE.operator.email,
        role: "operator",
        status: "active",
        slackTeamId: LOCAL_SLACK_FIXTURE.clarityTeamId,
        slackUserId: LOCAL_SLACK_FIXTURE.operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const brokerUserId = await upsertUser(ctx, {
      ...LOCAL_FIXTURE.broker.admin,
      accountKind: "customer",
      now,
      phone: brokerPhone,
      legacyEmails: ["terry@releaserent.com"],
    });
    const existingBrokerBySlug = await ctx.db
      .query("organizations")
      .withIndex("slug", (query) => query.eq("slug", LOCAL_FIXTURE.broker.slug))
      .first();
    const existingBroker =
      existingBrokerBySlug ??
      (await ctx.db
        .query("organizations")
        .withIndex("slug", (query) => query.eq("slug", "release"))
        .first());
    const brokerFields = {
      name: LOCAL_FIXTURE.broker.name,
      type: "broker" as const,
      slug: LOCAL_FIXTURE.broker.slug,
      website: LOCAL_FIXTURE.broker.website,
      agentHandle: LOCAL_FIXTURE.broker.agentHandle,
      whiteLabelingEnabled: false,
      onboardingComplete: true,
      operatorStatus: "live" as const,
    };
    let brokerOrgId: Id<"organizations">;
    if (existingBroker) {
      await ctx.db.patch(existingBroker._id, brokerFields);
      brokerOrgId = existingBroker._id;
    } else {
      brokerOrgId = await ctx.db.insert("organizations", brokerFields);
    }
    await ensureMembership(ctx, brokerOrgId, brokerUserId);
    const existingBrokerProfile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (query) => query.eq("brokerOrgId", brokerOrgId))
      .unique();
    const brokerProfileFields = {
      networkStatus: "active" as const,
      officeAddress: {
        street1: "161 Bay Street",
        street2: "Suite 2700",
        city: "Toronto",
        state: "ON",
        postalCode: "M5J 2S1",
        country: "Canada",
      },
      writingStates: ["CA", "NY", "TX"],
      lineOfBusinessCodes: ["CYBER", "EO", "OLIB"],
      updatedByUserId: operatorUserId,
      updatedAt: now,
    };
    if (existingBrokerProfile) {
      await ctx.db.patch(existingBrokerProfile._id, brokerProfileFields);
    } else {
      await ctx.db.insert("brokerProfiles", {
        brokerOrgId,
        ...brokerProfileFields,
        createdByUserId: operatorUserId,
        createdAt: now,
      });
    }

    const clientUserId = await upsertUser(ctx, {
      ...LOCAL_FIXTURE.client.admin,
      accountKind: "customer",
      now,
      phone: clientPhone,
    });
    const existingClient = await ctx.db
      .query("organizations")
      .withIndex("handle", (query) =>
        query.eq("agentHandle", LOCAL_FIXTURE.client.agentHandle),
      )
      .first();
    const clientFields = {
      name: LOCAL_FIXTURE.client.name,
      type: "client" as const,
      brokerOrgId: undefined,
      website: LOCAL_FIXTURE.client.website,
      industry: LOCAL_FIXTURE.client.industry,
      industryVertical: LOCAL_FIXTURE.client.industryVertical,
      agentHandle: LOCAL_FIXTURE.client.agentHandle,
      context: LOCAL_FIXTURE.client.context,
      primaryContactName: LOCAL_FIXTURE.client.admin.name,
      primaryContactEmail: LOCAL_FIXTURE.client.admin.email,
      allowedDomains: [] as string[],
      emailVerification: "strict" as const,
      onboardingComplete: true,
      operatorStatus: "live" as const,
    };
    let clientOrgId: Id<"organizations">;
    if (existingClient) {
      await ctx.db.patch(existingClient._id, clientFields);
      clientOrgId = existingClient._id;
    } else {
      clientOrgId = await ctx.db.insert("organizations", clientFields);
    }
    await ensureMembership(ctx, clientOrgId, clientUserId);

    const existingAssignment = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("organization_client", (query) =>
        query.eq("orgId", brokerOrgId).eq("clientOrgId", clientOrgId),
      )
      .first();
    if (existingAssignment) {
      await ctx.db.delete(existingAssignment._id);
    }

    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (query) => query.eq("orgId", clientOrgId))
      .collect();
    const existingPolicy = policies.find(
      (policy) => policy.policyNumber === LOCAL_FIXTURE.policy.policyNumber,
    );
    const policyFields = {
      orgId: clientOrgId,
      userId: clientUserId,
      uploadedBySide: "operator" as const,
      uploadedByUserId: operatorUserId,
      uploadedByBrokerOrgId: undefined,
      pipelineStatus: "complete" as const,
      extractionDataStage: "final" as const,
      extractionDataStageUpdatedAt: now,
      carrier: LOCAL_FIXTURE.policy.carrier,
      security: LOCAL_FIXTURE.policy.carrier,
      broker: LOCAL_FIXTURE.policy.broker,
      insurer: {
        ...LOCAL_FIXTURE.policy.insurer,
        sourceSpanIds: ["fixture-insurer"],
      },
      producer: {
        ...LOCAL_FIXTURE.policy.producer,
        sourceSpanIds: ["fixture-producer"],
      },
      generalAgent: {
        ...LOCAL_FIXTURE.policy.generalAgent,
        sourceSpanIds: ["fixture-general-agent"],
      },
      policyNumber: LOCAL_FIXTURE.policy.policyNumber,
      linesOfBusiness: [...LOCAL_FIXTURE.policy.linesOfBusiness],
      documentType: "policy" as const,
      policyYear: LOCAL_FIXTURE.policy.policyYear,
      effectiveDate: LOCAL_FIXTURE.policy.effectiveDate,
      expirationDate: LOCAL_FIXTURE.policy.expirationDate,
      isRenewal: false,
      coverages: LOCAL_FIXTURE.policy.coverages.map((coverage) => ({ ...coverage })),
      insuredName: LOCAL_FIXTURE.policy.insuredName,
      insuredAddress: {
        ...LOCAL_FIXTURE.policy.insuredAddress,
        sourceSpanIds: ["fixture-insured"],
      },
      operationalProfile: {
        documentType: "policy",
        linesOfBusiness: [...LOCAL_FIXTURE.policy.linesOfBusiness],
        namedInsured: {
          value: LOCAL_FIXTURE.policy.insuredName,
          confidence: "high",
          sourceNodeIds: ["fixture-declarations"],
          sourceSpanIds: ["fixture-insured"],
        },
        insurer: {
          value: LOCAL_FIXTURE.policy.insurer.legalName,
          confidence: "high",
          sourceNodeIds: ["fixture-declarations"],
          sourceSpanIds: ["fixture-insurer"],
        },
        broker: {
          value: LOCAL_FIXTURE.policy.producer.agencyName,
          confidence: "high",
          sourceNodeIds: ["fixture-declarations"],
          sourceSpanIds: ["fixture-producer"],
        },
        operationsDescription: {
          value: LOCAL_FIXTURE.policy.operationsDescription,
          confidence: "high",
          sourceNodeIds: ["fixture-operations"],
          sourceSpanIds: ["fixture-operations"],
        },
        coverages: [],
        parties: [
          {
            role: "named_insured",
            name: LOCAL_FIXTURE.policy.insuredName,
            address: LOCAL_FIXTURE.policy.insuredAddress,
            sourceNodeIds: ["fixture-declarations"],
            sourceSpanIds: ["fixture-insured"],
          },
          {
            role: "producer",
            name: LOCAL_FIXTURE.policy.producer.agencyName,
            address: LOCAL_FIXTURE.policy.producer.address,
            sourceNodeIds: ["fixture-declarations"],
            sourceSpanIds: ["fixture-producer"],
          },
          {
            role: "insurer",
            name: LOCAL_FIXTURE.policy.insurer.legalName,
            address: LOCAL_FIXTURE.policy.insurer.address,
            sourceNodeIds: ["fixture-declarations"],
            sourceSpanIds: ["fixture-insurer"],
          },
          {
            role: "general_agent",
            name: LOCAL_FIXTURE.policy.generalAgent.agencyName,
            address: LOCAL_FIXTURE.policy.generalAgent.address,
            sourceNodeIds: ["fixture-declarations"],
            sourceSpanIds: ["fixture-general-agent"],
          },
        ],
        endorsementSupport: [],
        sourceNodeIds: ["fixture-declarations", "fixture-operations"],
        sourceSpanIds: [
          "fixture-insured",
          "fixture-producer",
          "fixture-insurer",
          "fixture-general-agent",
          "fixture-operations",
        ],
        warnings: [],
      },
      premium: LOCAL_FIXTURE.policy.premium,
      premiumAmount: LOCAL_FIXTURE.policy.premiumAmount,
      summary: LOCAL_FIXTURE.policy.summary,
      isDemo: true,
    };
    let policyId: Id<"policies">;
    if (existingPolicy) {
      await ctx.db.patch(existingPolicy._id, policyFields);
      policyId = existingPolicy._id;
    } else {
      policyId = await ctx.db.insert("policies", policyFields);
    }
    await replacePolicyDeclarationFacts(ctx, policyId, now);

    return {
      operatorUserId,
      brokerUserId,
      clientUserId,
      brokerOrgId,
      clientOrgId,
      policyId,
      brokerPhone,
      clientPhone,
      operatorPhone,
      summary:
        "Seeded local fixture: Terry operator, standalone Montgomery Risk supplier profile, standalone Cove client, mock Slack service channel, stored favicon logos, and one final Cove policy",
    };
  },
});
