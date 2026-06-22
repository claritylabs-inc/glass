/// <reference types="vite/client" />
import dayjs from "dayjs";
import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { send } from "./sendNotificationEmail";

const modules = import.meta.glob("../**/*.ts");


const sendFn = send as any;

describe("sendNotificationEmail", () => {
  test("sets emailStatus=sent on success", async () => {
    const t = convexTest(schema, modules);

    // Set up broker org and client org
    const brokerOrgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Smith Insurance", type: "broker",
        agentDisplayName: "Sarah Smith",
      })
    );
    const clientOrgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Acme Co", type: "client",
        brokerOrgId: brokerOrgId,
      })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@acme.co" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId: clientOrgId, userId, role: "member" })
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId: clientOrgId,
        type: "policy_delivered_by_broker",
        title: "Application sent",
        body: "Smith Insurance sent you an application.",
        severity: "info",
        status: "unread",
        emailStatus: "scheduled",
        relatedOrgId: brokerOrgId,
        createdAt: dayjs().valueOf(),
      })
    );

    // Mock fetch for Resend — "info" severity defaults email off, so we need a pref row
    // to enable email for this user
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId,
        orgId: clientOrgId,
        type: "policy_delivered_by_broker",
        channel: "email",
        enabled: true,
        updatedAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-1" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");

    await t.action(sendFn, {
      notificationId: notifId,
    });

    const notif = await t.run(async (ctx) => ctx.db.get(notifId));
    expect(notif?.emailStatus).toBe("sent");
    expect((notif as any)?.emailSentAt).toBeDefined();

    // Verify sender and branding: notifications always use a stable Glass sender name.
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.from).toContain("Glass Notifications");
    expect(callBody.from).toContain("<notifications@notifications.glass.insure>");
    expect(callBody.html).toContain("Smith Insurance");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sets emailStatus=suppressed_by_preference when all recipients have email disabled", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Broker Co", type: "broker" })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@broker.co" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "member" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "__all__", channel: "email", enabled: false, updatedAt: dayjs().valueOf(),
      })
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "client_invitation_accepted",
        title: "Client joined",
        body: "Acme Co accepted the invitation.",
        severity: "info",
        status: "unread",
        emailStatus: "scheduled",
        createdAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await t.action(sendFn, { notificationId: notifId });

    const notif = await t.run(async (ctx) => ctx.db.get(notifId));
    expect(notif?.emailStatus).toBe("suppressed_by_preference");
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sets emailStatus=failed after Resend error, retries exhausted", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Broker Co", type: "broker" })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@broker.co" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "member" })
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "extraction_error",
        title: "Integration disconnected",
        body: "The integration was disconnected.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        createdAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "Rate limit exceeded",
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");

    await t.action(sendFn, { notificationId: notifId });

    expect(mockFetch).toHaveBeenCalledTimes(3); // 3 retries
    const notif = await t.run(async (ctx) => ctx.db.get(notifId));
    expect(notif?.emailStatus).toBe("failed");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("includes thread context when the notification references a thread", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Broker Co", type: "broker" })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@broker.co" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "member" })
    );
    const threadId = await t.run(async (ctx) =>
      ctx.db.insert("threads", {
        orgId,
        title: "Renewal Review",
        createdBy: userId,
        lastMessageAt: dayjs().valueOf(),
        originChannel: "chat",
      })
    );
    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "extraction_error",
        title: "Review needed",
        body: "The extraction needs attention.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        sourceRef: { threadId },
        createdAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-thread" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");

    await t.action(sendFn, { notificationId: notifId });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.from).toContain("Glass Notifications");
    expect(callBody.html).not.toContain("Notification for thread");
    expect(callBody.html).toContain("Renewal Review");
    expect(callBody.html).toContain('td align="left"');
    expect(callBody.text).toContain("Thread: Renewal Review");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("uses deep links for vendor compliance and thread notifications", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Acme Co", type: "client" })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Ava", email: "ava@acme.co" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "vendor_compliance_gap",
        channel: "email",
        enabled: true,
        updatedAt: dayjs().valueOf(),
      })
    );
    const threadId = await t.run(async (ctx) =>
      ctx.db.insert("threads", {
        orgId,
        title: "Vendor compliance follow-up - Cios",
        createdBy: userId,
        lastMessageAt: dayjs().valueOf(),
        originChannel: "chat",
      })
    );
    const vendorNotificationId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "vendor_compliance_gap",
        title: "Cios is missing vendor requirements",
        body: "1 vendor requirement needs attention.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        actionType: "view_vendor_compliance",
        actionPayload: { vendorOrgId: "vendor123" },
        createdAt: dayjs().valueOf(),
      })
    );
    const threadNotificationId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "vendor_compliance_gap",
        title: "Cios follow-up draft ready",
        body: "A follow-up email draft is ready.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        actionType: "view_thread",
        actionPayload: { threadId },
        createdAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-vendor" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");
    vi.stubEnv("SITE_URL", "https://glass.example");

    await t.action(sendFn, { notificationId: vendorNotificationId });
    await t.action(sendFn, { notificationId: threadNotificationId });

    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.text).toContain("https://glass.example/connect/vendors");
    expect(secondBody.text).toContain(`https://glass.example/agent/thread/${threadId}`);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sends application notifications with broker context and application deep link", async () => {
    const t = convexTest(schema, modules);

    const brokerOrgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Smith Insurance",
        type: "broker",
      })
    );
    const clientOrgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Acme Co",
        type: "client",
        brokerOrgId,
      })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Sarah", email: "sarah@smith.example" })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId: brokerOrgId, userId, role: "admin" })
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId: brokerOrgId,
        type: "application_intake_needs_review",
        title: "Application needs broker review",
        body: "General liability application",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        relatedOrgId: clientOrgId,
        actionType: "view_application_intake",
        actionPayload: {
          applicationIntakeId: "intake123",
          clientOrgId,
        },
        createdAt: dayjs().valueOf(),
      })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-app" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");
    vi.stubEnv("SITE_URL", "https://glass.example");

    await t.action(sendFn, { notificationId: notifId });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.from).toContain("Glass Notifications");
    expect(callBody.subject).toBe("Application needs broker review");
    expect(callBody.html).toContain("Smith Insurance");
    expect(callBody.html).toContain("Acme Co");
    expect(callBody.html).toContain("Review application");
    expect(callBody.html).not.toContain("from Clarity Labs");
    expect(callBody.html).not.toContain("Powered by");
    expect(callBody.text).toContain(
      `https://glass.example/clients/${clientOrgId}/applications?applicationId=intake123`,
    );

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
