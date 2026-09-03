/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { composeRequestMarkdown } from "./lib/procurementPacket";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, clientOrgId };
  });
  return {
    t,
    ...ids,
    operator: t.withIdentity({ subject: `${ids.operatorUserId}|session` }),
  };
}

describe("composeRequestMarkdown", () => {
  test("banners each block only when the other one has content", () => {
    expect(
      composeRequestMarkdown({
        wikiMarkdown: "",
        packetMarkdown: "## Summary\n\nRenewal.",
      }),
    ).toBe("## Summary\n\nRenewal.");
    expect(
      composeRequestMarkdown({
        wikiMarkdown: "## Company profile\n\n- A fleet.",
        packetMarkdown: "",
      }),
    ).toBe("# Client background\n\n## Company profile\n\n- A fleet.");
    expect(
      composeRequestMarkdown({
        wikiMarkdown: "## Company profile\n\n- A fleet.",
        packetMarkdown: "## Summary\n\nRenewal.",
      }),
    ).toBe(
      "# Client background\n\n## Company profile\n\n- A fleet.\n\n# Submission packet\n\n## Summary\n\nRenewal.",
    );
    expect(
      composeRequestMarkdown({ wikiMarkdown: "  ", packetMarkdown: "  " }),
    ).toBe("");
  });
});

describe("request packet composition", () => {
  test("composes the client wiki ahead of the request packet for an operator", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Fleet renewal",
      requestSummary: "Replace the expiring fleet program",
      requirements: "Auto liability $1m",
    });
    await f.operator.mutation(api.orgWiki.upsertSectionForOperator, {
      orgId: f.clientOrgId,
      key: "profile",
      body: "- Cove operates a commercial vehicle fleet.",
    });
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "summary",
      body: "Renewal of the fleet program.",
    });

    const packet = await f.operator.query(api.procurementPacket.get, {
      requestId: request.requestId,
    });

    expect(packet.markdown).toBe(
      [
        "# Client background",
        "",
        "## Company profile",
        "",
        "- Cove operates a commercial vehicle fleet.",
        "",
        "# Submission packet",
        "",
        "## Summary",
        "",
        "Renewal of the fleet program.",
      ].join("\n"),
    );
    expect(packet.clientWiki?.markdown).toBe(
      "## Company profile\n\n- Cove operates a commercial vehicle fleet.",
    );
    // The wiki composes in without being copied, so it never becomes a packet
    // section and never closes a canonical gap.
    expect(packet.sections.map((section) => section.key)).toEqual(["summary"]);
    expect(packet.gaps.map((gap) => gap.key)).toContain("named_insured");
  });

  test("keeps the wiki out of the client and broker projections", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Fleet renewal",
      requestSummary: "Replace the expiring fleet program",
      requirements: "Auto liability $1m",
    });
    await f.operator.mutation(api.orgWiki.upsertSectionForOperator, {
      orgId: f.clientOrgId,
      key: "profile",
      body: "- Cove operates a commercial vehicle fleet.",
    });
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "summary",
      body: "Renewal of the fleet program.",
    });
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "market_strategy",
      body: "Approach admitted markets first.",
    });

    for (const audience of ["client", "broker"] as const) {
      const projection = await f.operator.query(api.procurementPacket.get, {
        requestId: request.requestId,
        audience,
      });
      expect(projection.clientWiki).toBeNull();
      expect(projection.markdown).toBe(
        "## Summary\n\nRenewal of the fleet program.",
      );
      expect(projection.markdown).not.toContain("commercial vehicle fleet");
      expect(projection.markdown).not.toContain("admitted markets");
    }
  });
});
