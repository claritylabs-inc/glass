/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
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
  test("issues immutable broker snapshots and revokes packet and file access", async () => {
    const f = await fixture();
    const brokerOrgId = await f.t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      }),
    );
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Property placement",
      narrative: "Insure the Carroll Avenue property",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId,
        contactName: "Dana Reyes",
        contactEmail: "dana@example.com",
      },
    );
    const otherOutreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId,
        contactName: "Alex Morgan",
        contactEmail: "alex@example.com",
      },
    );
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        recipientLabel: "Dana Reyes",
        expiresAt: dayjs().subtract(1, "minute").valueOf(),
      }),
    ).rejects.toThrow("Packet link expiry must be in the future");
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        recipientLabel: "Dana Reyes",
        expiresAt: dayjs().add(91, "day").valueOf(),
      }),
    ).rejects.toThrow("Packet links may expire at most 90 days after issue");
    // A browser clock a few seconds ahead must not lose the maximum lifetime,
    // so callers name days and the server dates them.
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        recipientLabel: "Dana Reyes",
        expiresAt: dayjs().add(90, "day").add(5, "second").valueOf(),
      }),
    ).rejects.toThrow("Packet links may expire at most 90 days after issue");
    const maximumLifetime = await f.operator.mutation(
      api.procurementPacket.mintLink,
      {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        recipientLabel: "Dana Reyes",
        expiresInDays: 90,
      },
    );
    expect(maximumLifetime.expiresAt).toBeGreaterThan(
      dayjs().add(89, "day").valueOf(),
    );
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        recipientLabel: "Dana Reyes",
        expiresInDays: 91,
      }),
    ).rejects.toThrow("Packet link lifetime must be between 1 and 90 days");
    await f.operator.mutation(api.procurementPacket.revokeLink, {
      linkId: maximumLifetime.id,
    });
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "summary",
      body: "Original broker submission.",
      audience: "broker",
    });
    const clientFileId = await f.t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const fileId = await ctx.storage.store(
        new Blob(["application"], { type: "application/pdf" }),
      );
      return await ctx.db.insert("clientFiles", {
        orgId: f.clientOrgId,
        fileId,
        name: "Application.pdf",
        originalName: "Application.pdf",
        contentType: "application/pdf",
        size: 11,
        clientVisible: false,
        uploadedByUserId: f.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
    });
    const fileItem = await f.operator.mutation(
      api.procurementRequests.createFileItem,
      {
        requestId: request.requestId,
        clientFileId,
        purpose: "application",
        label: "Broker application",
        status: "available",
      },
    );
    await f.operator.mutation(api.procurementPacket.setFileRelease, {
      itemId: fileItem.fileItemId,
      brokerRelease: "attached",
    });
    const otherFileItemId = await f.t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const fileId = await ctx.storage.store(
        new Blob(["other broker"], { type: "application/pdf" }),
      );
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId: f.clientOrgId,
        fileId,
        name: "Other-broker-only.pdf",
        originalName: "Other-broker-only.pdf",
        contentType: "application/pdf",
        size: 12,
        clientVisible: false,
        uploadedByUserId: f.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("procurementFileItems", {
        requestId: request.requestId,
        clientOrgId: f.clientOrgId,
        outreachId: otherOutreach.outreachId,
        clientFileId,
        purpose: "application",
        label: "Other broker only",
        status: "available",
        brokerRelease: "attached",
        clientVisible: false,
        createdByUserId: f.operatorUserId,
        updatedByUserId: f.operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
    });
    const brokerPreview = await f.operator.query(
      api.procurementPacket.preview,
      {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
      },
    );
    expect(brokerPreview.files.map((file) => file.name)).toEqual([
      "Broker application",
    ]);
    const issued = await f.operator.mutation(api.procurementPacket.mintLink, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      recipientLabel: "Dana Reyes",
      recipientEmail: "dana@example.com",
    });
    const { originalFileId, replacementClientFileId } = await f.t.run(
      async (ctx) => {
        const original = await ctx.db.get(clientFileId);
        if (!original) throw new Error("Expected original client file");
        const now = dayjs().valueOf();
        const replacementFileId = await ctx.storage.store(
          new Blob(["replacement"], { type: "application/pdf" }),
        );
        const replacementClientFileId = await ctx.db.insert("clientFiles", {
          orgId: f.clientOrgId,
          fileId: replacementFileId,
          name: "Replacement.pdf",
          originalName: "Replacement.pdf",
          contentType: "application/pdf",
          size: 11,
          clientVisible: false,
          uploadedByUserId: f.operatorUserId,
          uploadedBySide: "operator",
          nameSource: "original",
          nameStatus: "ready",
          createdAt: now,
          updatedAt: now,
        });
        return { originalFileId: original.fileId, replacementClientFileId };
      },
    );

    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "summary",
      body: "Updated after issue.",
      audience: "broker",
    });
    await f.operator.mutation(api.procurementRequests.updateFileItem, {
      fileItemId: fileItem.fileItemId,
      clientFileId: replacementClientFileId,
      label: "Replacement application",
    });
    const publicView = await f.t.query(api.procurementPacket.getByToken, {
      token: issued.token,
    });
    expect(publicView).toMatchObject({
      recipientLabel: "Dana Reyes",
      files: [
        expect.objectContaining({
          _id: fileItem.fileItemId,
          name: "Broker application",
          brokerRelease: "attached",
        }),
      ],
    });
    expect(publicView?.markdown).toContain("Original broker submission");
    expect(publicView?.markdown).not.toContain("Updated after issue");
    expect(publicView?.files).toHaveLength(1);
    expect(publicView?.files[0]?.downloadUrl).toContain("packet-file");
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: otherFileItemId,
      }),
    ).resolves.toBeNull();
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: fileItem.fileItemId,
      }),
    ).resolves.toMatchObject({
      fileId: originalFileId,
      name: "Broker application",
    });

    await f.operator.mutation(api.procurementPacket.setFileRelease, {
      itemId: fileItem.fileItemId,
      brokerRelease: "listed",
    });
    const narrowedView = await f.t.query(api.procurementPacket.getByToken, {
      token: issued.token,
    });
    expect(narrowedView?.files[0]).toMatchObject({
      name: "Broker application",
      brokerRelease: "listed",
      downloadUrl: null,
    });
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: fileItem.fileItemId,
      }),
    ).resolves.toBeNull();
    await expect(
      f.t.mutation(api.procurementPacket.recordView, {
        token: "wrong-token",
      }),
    ).resolves.toEqual({ ok: false });
    await expect(
      f.t.mutation(api.procurementPacket.recordView, {
        token: issued.token,
        userAgent: "packet-test",
      }),
    ).resolves.toEqual({ ok: true });

    await f.operator.mutation(api.procurementPacket.revokeLink, {
      linkId: issued.id,
    });
    await expect(
      f.t.query(api.procurementPacket.getByToken, { token: issued.token }),
    ).resolves.toBeNull();
    const links = await f.operator.query(api.procurementPacket.listLinks, {
      requestId: request.requestId,
    });
    expect(links[0]).toMatchObject({
      linkId: issued.id,
      state: "revoked",
      stale: true,
      sectionCount: expect.any(Number),
      fileCount: 1,
      viewCount: 1,
    });
  });

  test("composes the client wiki ahead of the request packet for an operator", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Fleet renewal",
      narrative: "Replace the expiring fleet program",
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
        "## Client narrative",
        "",
        "Replace the expiring fleet program",
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
    expect(packet.sections.map((section) => section.key)).toEqual([
      "intake_narrative",
      "summary",
    ]);
    expect(packet.gaps.map((gap) => gap.key)).toContain("named_insured");
  });

  test("keeps the wiki out of the client and broker projections", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Fleet renewal",
      narrative: "Replace the expiring fleet program",
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

    // The intake narrative is client-visible but not broker-visible, so it
    // reaches the client projection and stops before the broker one.
    const expectedMarkdown = {
      client:
        "## Client narrative\n\nReplace the expiring fleet program\n\n## Summary\n\nRenewal of the fleet program.",
      broker: "## Summary\n\nRenewal of the fleet program.",
    };
    for (const audience of ["client", "broker"] as const) {
      const projection = await f.operator.query(api.procurementPacket.get, {
        requestId: request.requestId,
        audience,
      });
      expect(projection.clientWiki).toBeNull();
      expect(projection.markdown).toBe(expectedMarkdown[audience]);
      expect(projection.markdown).not.toContain("commercial vehicle fleet");
      expect(projection.markdown).not.toContain("admitted markets");
    }
  });
});
