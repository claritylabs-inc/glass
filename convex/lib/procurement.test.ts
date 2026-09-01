import { describe, expect, test } from "vitest";

import {
  inferProcurementEmailCategory,
  normalizeProcurementSubject,
  procurementForwardingAddress,
  procurementInboxTokenFromAddresses,
} from "./procurement";

describe("procurement email routing", () => {
  test("resolves exact request tokens from To, Cc, or Bcc recipient lists", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const address = procurementForwardingAddress(token, "agent.spot.insure");

    expect(
      procurementInboxTokenFromAddresses(
        ["someone@example.com", address],
        ["agent.spot.insure"],
      ),
    ).toBe(token);
    expect(
      procurementInboxTokenFromAddresses(
        [`procurement+${token}@attacker.example`],
        ["agent.spot.insure"],
      ),
    ).toBeNull();
    expect(
      procurementInboxTokenFromAddresses(
        ["procurement+short@agent.spot.insure"],
        ["agent.spot.insure"],
      ),
    ).toBeNull();
  });

  test("normalizes reply and forward prefixes for subject threading", () => {
    expect(normalizeProcurementSubject(" Re: Fwd:  Property Quote ")).toBe(
      "property quote",
    );
  });

  test("categorizes from exact participant evidence and preserves ambiguity", () => {
    expect(
      inferProcurementEmailCategory({
        participantEmails: ["BROKER@example.com"],
        brokerEmails: ["broker@example.com"],
        clientEmails: [],
        operatorEmails: [],
      }),
    ).toMatchObject({ category: "broker" });

    expect(
      inferProcurementEmailCategory({
        participantEmails: ["broker@example.com", "client@example.com"],
        brokerEmails: ["broker@example.com"],
        clientEmails: ["client@example.com"],
        operatorEmails: [],
      }),
    ).toMatchObject({ category: "mixed" });
  });
});
