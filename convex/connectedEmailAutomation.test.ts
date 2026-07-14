/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  attachThreadInternal,
  claimItemInternal,
  failItemInternal,
  finishItemInternal,
  getScanStateInternal,
  recordScanAttemptInternal,
  recordScanSuccessInternal,
  recordUnreadableItemInternal,
  reviewForThread,
} from "./connectedEmailAutomation";

const modules = import.meta.glob("./**/*.ts");
const claimItemFn = claimItemInternal as any;
const attachThreadFn = attachThreadInternal as any;
const failItemFn = failItemInternal as any;
const finishItemFn = finishItemInternal as any;
const getScanStateFn = getScanStateInternal as any;
const recordScanAttemptFn = recordScanAttemptInternal as any;
const recordScanSuccessFn = recordScanSuccessInternal as any;
const recordUnreadableFn = recordUnreadableItemInternal as any;
const reviewForThreadFn = reviewForThread as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { email: "user@example.com" });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    const accountId = await ctx.db.insert("connectedEmailAccounts", {
      orgId,
      userId,
      scope: "user",
      emailAddress: "user@example.com",
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      encryptedPassword: "encrypted",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { orgId, userId, accountId };
  });
  return { t, ...ids };
}

describe("connected email automation ledger", () => {
  test("resets the UID cursor when UIDVALIDITY changes", async () => {
    const { t, orgId, accountId } = await seed();
    const base = { accountId, orgId, mailbox: "INBOX" };
    await t.mutation(recordScanSuccessFn, {
      ...base,
      uidValidity: "one",
      lastUid: 42,
    });
    await t.mutation(recordScanAttemptFn, {
      ...base,
      uidValidity: "two",
    });

    const state = await t.query(getScanStateFn, {
      accountId,
      mailbox: "INBOX",
    });
    expect(state).toMatchObject({ uidValidity: "two" });
    expect(state.lastUid).toBeUndefined();
  });

  test("never reclaims or fails a completed message", async () => {
    const { t, orgId, userId, accountId } = await seed();
    const args = {
      accountId,
      orgId,
      userId,
      mailbox: "INBOX",
      uid: 42,
      messageKey: "message-key",
      emailRef: "email-ref",
      subject: "Policy documents",
      classification: "policy_document" as const,
      confidence: 0.99,
      reason: "Explicit bound policy attachment.",
    };
    const first = await t.mutation(claimItemFn, args);
    expect(first.claimed).toBe(true);
    await t.mutation(finishItemFn, {
      itemId: first.itemId,
      status: "completed",
      actionSummary: "Policy imported.",
    });
    await t.mutation(failItemFn, {
      itemId: first.itemId,
      error: "late scan failure",
    });

    const second = await t.mutation(claimItemFn, args);
    expect(second).toMatchObject({
      claimed: false,
      itemId: first.itemId,
      status: "completed",
    });
    const item = await t.run((ctx) =>
      ctx.db.get(first.itemId) as Promise<Doc<"connectedEmailAutomationItems"> | null>,
    );
    expect(item?.status).toBe("completed");
    expect(item?.lastError).toBeUndefined();
  });

  test("surfaces thread-linked review context without persisting the email body", async () => {
    const { t, orgId, userId, accountId } = await seed();
    const threadId = await t.run((ctx) =>
      ctx.db.insert("threads", {
        orgId,
        title: "Mailbox items needing attention",
        createdBy: userId,
        visibility: "user_private",
        lastMessageAt: 1,
        originChannel: "chat",
      }),
    );
    const claim = await t.mutation(claimItemFn, {
      accountId,
      orgId,
      userId,
      mailbox: "INBOX",
      uid: 42,
      messageKey: "review-key",
      emailRef: "review-ref",
      subject: "Policy documents",
      from: "broker@example.com",
      receivedAt: 1_700_000_000_000,
      classification: "review_needed",
      confidence: 0,
      reason: "The mailbox classifier did not return a complete decision.",
    });
    await t.mutation(finishItemFn, {
      itemId: claim.itemId,
      status: "completed",
      needsReview: true,
      reviewReason: "The mailbox classifier did not return a complete decision.",
    });
    await t.mutation(attachThreadFn, { itemId: claim.itemId, threadId });

    const review = await t
      .withIdentity(sessionFor(userId))
      .query(reviewForThreadFn, { threadId });

    expect(review).toMatchObject({
      title: "Mailbox review - user@example.com",
      status: "needs_review",
      evidence: {
        emails: [{
          emailRef: "review-ref",
          subject: "Policy documents",
          from: "broker@example.com",
          attachments: [],
        }],
      },
    });
    expect(review.evidence.emails[0].reason).toContain(
      "Review the live message",
    );
    expect(review.evidence.emails[0]).not.toHaveProperty("text");
  });

  test("skips a permanently unreadable message after repeated attempts so the watermark can advance", async () => {
    const { t, orgId, userId, accountId } = await seed();
    const args = {
      accountId,
      orgId,
      userId,
      mailbox: "INBOX",
      uid: 7,
      messageKey: "unreadable-key",
      emailRef: "unreadable-ref",
      error: "IMAP FETCH failed",
    };

    expect(await t.mutation(recordUnreadableFn, args)).toEqual({
      attempts: 1,
      willRetry: true,
    });
    expect(await t.mutation(recordUnreadableFn, args)).toEqual({
      attempts: 2,
      willRetry: true,
    });
    expect(await t.mutation(recordUnreadableFn, args)).toEqual({
      attempts: 3,
      willRetry: false,
    });

    const item = await t.run(async (ctx) => {
      const items = await ctx.db
        .query("connectedEmailAutomationItems")
        .withIndex("by_accountId_messageKey", (query: any) =>
          query.eq("accountId", accountId).eq("messageKey", "unreadable-key"),
        )
        .first();
      return items as Doc<"connectedEmailAutomationItems"> | null;
    });
    expect(item?.status).toBe("skipped");
    expect(item?.lastError).toBe("IMAP FETCH failed");
    expect(item?.attempts).toBe(3);

    // Once skipped, later scans and claims must treat it as done so the scan
    // watermark advances past the poisoned uid instead of stalling forever.
    expect(await t.mutation(recordUnreadableFn, args)).toEqual({
      attempts: 3,
      willRetry: false,
    });
    const claim = await t.mutation(claimItemFn, {
      accountId,
      orgId,
      userId,
      mailbox: "INBOX",
      uid: 7,
      messageKey: "unreadable-key",
      emailRef: "unreadable-ref",
      subject: "(unreadable message)",
      classification: "review_needed" as const,
      confidence: 0,
      reason: "retry",
    });
    expect(claim).toMatchObject({ claimed: false, status: "skipped" });
  });
});
