/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import {
  normalizeAvailableUserPhone,
  normalizeUserPhone,
  PHONE_IN_USE_MESSAGE,
} from "./userPhone";

const modules = import.meta.glob("../**/*.ts");

describe("user phone helpers", () => {
  test("normalizes valid US phone numbers to E.164", () => {
    expect(normalizeUserPhone("(701) 515-9759")).toBe("+17015159759");
  });

  test("blocks assigning another user's phone number", async () => {
    const t = convexTest(schema, modules);

    const message = await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "one@example.com",
        phone: "+17015159759",
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "two@example.com",
      });
      try {
        await normalizeAvailableUserPhone(ctx, "7015159759", otherUserId);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    expect(message).toBe(PHONE_IN_USE_MESSAGE);
  });

  test("rejects numbers that only match the E.164 shape", () => {
    expect(() => normalizeUserPhone("+15555550103")).toThrow(
      "Enter a valid phone number with country code.",
    );
  });
});
