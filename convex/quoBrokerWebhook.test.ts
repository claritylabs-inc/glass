/// <reference types="vite/client" />
import dayjs from "dayjs";
import { createHmac, randomBytes } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllEnvs());

test("authenticates and idempotently records broker message deliveries", async () => {
  const t = convexTest(schema, modules);
  const signingKey = randomBytes(32).toString("base64");
  vi.stubEnv("QUO_BROKER_WEBHOOK_SECRET", signingKey);
  vi.stubEnv("QUO_BROKER_PHONE_NUMBER_ID", "PN-spot");

  const payload = {
    id: "EV-inbound",
    object: "event",
    apiVersion: "v4",
    createdAt: "2026-09-04T17:00:00.000Z",
    type: "message.received",
    data: {
      object: {
        id: "AC-message",
        object: "message",
        from: "+16475550100",
        to: ["+16282275427"],
        direction: "incoming",
        text: "Can help",
        status: "delivered",
        createdAt: "2026-09-04T17:00:00.000Z",
        phoneNumberId: "PN-spot",
      },
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = dayjs().valueOf();
  const digest = createHmac("sha256", Buffer.from(signingKey, "base64"))
    .update(`${timestamp}.${body}`, "utf8")
    .digest("base64");
  const request = () =>
    t.fetch("/quo-brokers/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "openphone-signature": `hmac;1;${timestamp};${digest}`,
      },
      body,
    });

  await expect(request()).resolves.toMatchObject({ status: 200 });
  await expect(request()).resolves.toMatchObject({ status: 200 });

  const rows = await t.run((ctx) =>
    ctx.db.query("procurementSmsEvents").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    providerEventId: "EV-inbound",
    counterpartyPhone: "+16475550100",
    body: "Can help",
  });
});
