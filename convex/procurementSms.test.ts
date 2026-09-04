/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("stores a Quo event once when delivery is retried", async () => {
  const t = convexTest(schema, modules);
  const event = {
    providerEventId: "EV-retried",
    providerMessageId: "AC-message",
    eventType: "message.received" as const,
    phoneNumberId: "PN-spot",
    counterpartyPhone: "+16475550100",
    direction: "incoming" as const,
    from: "+16475550100",
    to: ["+16282275427"],
    body: "Can help",
    providerCreatedAt: "2026-09-04T17:00:00.000Z",
  };

  await expect(
    t.mutation(internal.procurementSms.ingestQuoEvent, event),
  ).resolves.toMatchObject({ duplicate: false });
  await expect(
    t.mutation(internal.procurementSms.ingestQuoEvent, event),
  ).resolves.toMatchObject({ duplicate: true });

  const rows = await t.run((ctx) =>
    ctx.db.query("procurementSmsEvents").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    providerEventId: "EV-retried",
    body: "Can help",
  });
});
