/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { extractQuestionGraphFromFields } from "@claritylabs/cl-sdk/application";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const startFn = api.applicationIntakes.start as any;
const saveTemplateFn = api.applicationIntakes.saveTemplate as any;
const recordAnswersFn = api.applicationIntakes.recordAnswers as any;
const preparePacketFn = api.applicationIntakes.preparePacket as any;
const markSubmittedFn = api.applicationIntakes.markSubmitted as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function seedBrokerClient() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker Co",
      type: "broker",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client Co",
      type: "client",
      brokerOrgId,
    });
    const brokerUserId = await ctx.db.insert("users", {
      name: "Broker Admin",
      email: "broker@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "admin",
    });
    return { brokerUserId, clientOrgId };
  });
  return { t, ...ids };
}

async function seedStandaloneClient() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Standalone Client Co",
      type: "client",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client Admin",
      email: "client@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "admin",
    });
    return { clientOrgId, clientUserId };
  });
  return { t, ...ids };
}

describe("applicationIntakes portal lifecycle", () => {
  test("lets a broker collect answers, prepare a packet, and mark it submitted", async () => {
    const { t, brokerUserId, clientOrgId } = await seedBrokerClient();
    const brokerSession = sessionFor(brokerUserId);

    const intake = await t.withIdentity(brokerSession).mutation(startFn, {
      orgId: clientOrgId,
      sourceKind: "broker_portal",
      title: "General liability application",
      requestText: "Collect the GL submission information.",
      missingQuestions: [
        {
          fieldId: "revenue",
          label: "Annual revenue",
          prompt: "What is the annual revenue?",
          required: true,
        },
        {
          fieldId: "locations",
          label: "Locations",
          prompt: "How many locations does the business operate?",
          required: true,
        },
      ],
    });

    expect(intake?.status).toBe("collecting");
    expect(intake?.missingQuestions).toHaveLength(2);

    const partlyAnswered = await t.withIdentity(brokerSession).mutation(recordAnswersFn, {
      applicationIntakeId: intake!._id,
      sourceKind: "broker_portal",
      answers: [
        {
          fieldId: "revenue",
          label: "Annual revenue",
          value: "$2,000,000",
          source: "broker_portal",
        },
      ],
    });

    expect(partlyAnswered?.status).toBe("collecting");
    expect(partlyAnswered?.normalizedAnswers).toHaveLength(1);
    expect(partlyAnswered?.missingQuestions.map((question: { fieldId: string }) => question.fieldId)).toEqual([
      "locations",
    ]);

    const fullyAnswered = await t.withIdentity(brokerSession).mutation(recordAnswersFn, {
      applicationIntakeId: intake!._id,
      sourceKind: "broker_portal",
      answers: [
        {
          fieldId: "locations",
          label: "Locations",
          value: "3",
          source: "broker_portal",
        },
      ],
      message: "Client confirmed remaining locations.",
    });

    expect(fullyAnswered?.status).toBe("needs_broker_review");
    expect(fullyAnswered?.missingQuestions).toHaveLength(0);
    expect(fullyAnswered?.normalizedAnswers).toHaveLength(2);

    const packet = await t.withIdentity(brokerSession).mutation(preparePacketFn, {
      applicationIntakeId: intake!._id,
      submissionNotes: "Ready for broker submission.",
    });

    expect(packet?.status).toBe("broker_ready");
    expect(packet?.missingFieldIds).toEqual([]);

    const submitted = await t.withIdentity(brokerSession).mutation(markSubmittedFn, {
      applicationIntakeId: intake!._id,
    });

    expect(submitted?.status).toBe("submitted");

    const storedPacket = await t.run(async (ctx) =>
      ctx.db.get(packet!._id as Id<"applicationPackets">),
    );
    expect(storedPacket?.status).toBe("submitted");
    expect(storedPacket?.submittedAt).toEqual(expect.any(Number));
  });

  test("clears the current packet when answers change after packet preparation", async () => {
    const { t, brokerUserId, clientOrgId } = await seedBrokerClient();
    const brokerSession = sessionFor(brokerUserId);

    const intake = await t.withIdentity(brokerSession).mutation(startFn, {
      orgId: clientOrgId,
      sourceKind: "broker_portal",
      title: "Cyber renewal application",
      requestText: "Collect cyber renewal details.",
      missingQuestions: [
        {
          fieldId: "revenue",
          label: "Annual revenue",
          prompt: "What is the annual revenue?",
          required: true,
        },
      ],
    });

    await t.withIdentity(brokerSession).mutation(recordAnswersFn, {
      applicationIntakeId: intake!._id,
      sourceKind: "broker_portal",
      answers: [
        {
          fieldId: "revenue",
          label: "Annual revenue",
          value: "$2,000,000",
          source: "broker_portal",
        },
      ],
    });
    const packet = await t.withIdentity(brokerSession).mutation(preparePacketFn, {
      applicationIntakeId: intake!._id,
    });

    const currentBeforeEdit = await t.run(async (ctx) =>
      ctx.db.get(intake!._id as Id<"applicationIntakes">),
    );
    expect(currentBeforeEdit?.packetId).toBe(packet?._id);
    expect(currentBeforeEdit?.status).toBe("broker_ready");

    const edited = await t.withIdentity(brokerSession).mutation(recordAnswersFn, {
      applicationIntakeId: intake!._id,
      sourceKind: "broker_portal",
      answers: [
        {
          fieldId: "revenue",
          label: "Annual revenue",
          value: "$2,500,000",
          source: "broker_portal",
        },
      ],
    });

    expect(edited?.packetId).toBeUndefined();
    expect(edited?.status).toBe("needs_broker_review");
    expect(edited?.normalizedAnswers).toMatchObject([
      {
        fieldId: "revenue",
        value: "$2,500,000",
      },
    ]);

    const stalePacket = await t.run(async (ctx) =>
      ctx.db.get(packet!._id as Id<"applicationPackets">),
    );
    expect(stalePacket?.status).toBe("broker_ready");
  });

  test("starts broker applications from reusable templates", async () => {
    const { t, brokerUserId, clientOrgId } = await seedBrokerClient();
    const brokerSession = sessionFor(brokerUserId);

    const questionGraph = extractQuestionGraphFromFields(
      [
        {
          id: "annual_revenue",
          label: "Annual revenue",
          section: "Operations",
          fieldType: "text",
          required: true,
        },
        {
          id: "employee_count",
          label: "Employee count",
          section: "Operations",
          fieldType: "numeric",
          required: true,
        },
      ],
      {
        id: "gl-template:graph",
        version: "v1",
        title: "General liability application",
        applicationType: "general_liability",
        source: "manual",
      },
    );

    const template = await t.withIdentity(brokerSession).mutation(saveTemplateFn, {
      title: "General liability application",
      applicationType: "general_liability",
      lineOfBusiness: "General liability",
      product: "Primary GL",
      status: "active",
      sourceKind: "manual",
      questionGraph,
    });

    expect(template?.status).toBe("active");
    expect(template?.fieldCount).toBe(2);

    const intake = await t.withIdentity(brokerSession).mutation(startFn, {
      orgId: clientOrgId,
      templateId: template!._id,
      sourceKind: "broker_portal",
      requestText: "Start the GL application from the reusable template.",
    });

    expect(intake?.templateId).toBe(template?._id);
    expect(intake?.title).toBe("General liability application");
    expect(intake?.lineOfBusiness).toBe("General liability");
    expect(intake?.product).toBe("Primary GL");
    expect(intake?.missingQuestions.map((question: { fieldId: string }) => question.fieldId)).toEqual([
      "annual_revenue",
      "employee_count",
    ]);
  });

  test("lets standalone clients start from an uploaded application context without a broker", async () => {
    const { t, clientOrgId, clientUserId } = await seedStandaloneClient();
    const clientSession = sessionFor(clientUserId);

    const intake = await t.withIdentity(clientSession).mutation(startFn, {
      orgId: clientOrgId,
      sourceKind: "web",
      title: "Carrier application PDF",
      requestText: "Uploaded carrier application PDF with operations and revenue fields.",
      missingQuestions: [
        {
          fieldId: "annual_revenue",
          label: "Annual revenue",
          prompt: "What is the annual revenue?",
          required: true,
        },
      ],
    });

    expect(intake?.brokerOrgId).toBeUndefined();
    expect(intake?.status).toBe("collecting");

    const answered = await t.withIdentity(clientSession).mutation(recordAnswersFn, {
      applicationIntakeId: intake!._id,
      sourceKind: "web",
      answers: [
        {
          fieldId: "annual_revenue",
          label: "Annual revenue",
          value: "$1,500,000",
          source: "web_chat",
        },
      ],
      message: "Revenue is $1.5M.",
    });

    expect(answered?.status).toBe("needs_broker_review");
    expect(answered?.brokerOrgId).toBeUndefined();

    const packet = await t.withIdentity(clientSession).mutation(preparePacketFn, {
      applicationIntakeId: intake!._id,
    });
    expect(packet?.status).toBe("broker_ready");

    await expect(
      t.withIdentity(clientSession).mutation(markSubmittedFn, {
        applicationIntakeId: intake!._id,
      }),
    ).rejects.toThrow("Only brokers can mark applications submitted");
  });
});
