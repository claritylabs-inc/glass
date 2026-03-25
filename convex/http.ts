import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/resend-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Pass raw body + svix headers for signature verification in the action
    const rawBody = await request.text();
    const svixId = request.headers.get("svix-id") ?? "";
    const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
    const svixSignature = request.headers.get("svix-signature") ?? "";

    await ctx.runAction(internal.actions.handleInboundEmail.processInbound, {
      payload: rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
    });
    return new Response("OK", { status: 200 });
  }),
});

// ── MCP API Routes ──

const JSON_HEADERS = { "Content-Type": "application/json" };

type ApiKeyIdentity = {
  userId: string;
  orgId: string;
  keyId: string;
};

async function requireApiKey(
  ctx: { runQuery: any; runMutation: any },
  request: Request,
): Promise<ApiKeyIdentity> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response("Missing or invalid Authorization header", {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith("prism_")) {
    throw new Response("Invalid API key format", {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const result = await ctx.runQuery(internal.apiKeys.validateKey, { keyHash });

  if (!result) {
    throw new Response("Invalid or revoked API key", {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  // Update last used timestamp
  await ctx.runMutation(internal.apiKeys.touchLastUsed, { id: result.keyId });

  return result;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getQueryParam(request: Request, name: string): string | null {
  const url = new URL(request.url);
  return url.searchParams.get(name);
}

// GET /mcp/policies/list
http.route({
  path: "/mcp/policies/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as any,
      });

      // Apply optional filters from query params
      const carrier = getQueryParam(request, "carrier");
      const year = getQueryParam(request, "year");
      const type = getQueryParam(request, "type");

      const filtered = policies.filter((p: any) => {
        if (carrier && p.carrier !== carrier) return false;
        if (year && p.policyYear !== parseInt(year)) return false;
        if (type && !(p.policyTypes ?? []).includes(type)) return false;
        return true;
      });

      // Return lightweight summaries
      return jsonResponse(
        filtered.map((p: any) => ({
          _id: p._id,
          carrier: p.carrier,
          security: p.security,
          broker: p.broker,
          policyNumber: p.policyNumber,
          policyTypes: p.policyTypes,
          policyYear: p.policyYear,
          effectiveDate: p.effectiveDate,
          expirationDate: p.expirationDate,
          premium: p.premium,
          insuredName: p.insuredName,
          summary: p.summary,
          isRenewal: p.isRenewal,
          coverages: p.coverages,
        })),
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/get
http.route({
  path: "/mcp/policies/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const policy = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as any,
      });
      const found = policy.find((p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      // Return full detail (excluding raw extraction responses)
      const { rawExtractionResponse, rawMetadataResponse, ...rest } = found;
      return jsonResponse(rest);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/search
http.route({
  path: "/mcp/policies/search",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const q = getQueryParam(request, "q");
      if (!q) return jsonResponse({ error: "Missing q parameter" }, 400);

      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as any,
      });

      const query = q.toLowerCase();
      const results = policies.filter((p: any) => {
        const searchable = [
          p.carrier,
          p.policyNumber,
          p.insuredName,
          p.summary,
          p.security,
          p.broker,
          ...(p.policyTypes ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      });

      return jsonResponse(
        results.map((p: any) => ({
          _id: p._id,
          carrier: p.carrier,
          policyNumber: p.policyNumber,
          policyTypes: p.policyTypes,
          policyYear: p.policyYear,
          effectiveDate: p.effectiveDate,
          expirationDate: p.expirationDate,
          premium: p.premium,
          insuredName: p.insuredName,
          summary: p.summary,
        })),
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/stats
http.route({
  path: "/mcp/policies/stats",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as any,
      });

      const byType: Record<string, number> = {};
      const byCarrier: Record<string, number> = {};
      const byYear: Record<string, number> = {};

      for (const p of policies) {
        const types = (p as any).policyTypes ?? ["other"];
        for (const t of types) {
          byType[t] = (byType[t] || 0) + 1;
        }
        byCarrier[(p as any).carrier] = (byCarrier[(p as any).carrier] || 0) + 1;
        byYear[(p as any).policyYear] = (byYear[(p as any).policyYear] || 0) + 1;
      }

      return jsonResponse({
        totalPolicies: policies.length,
        byType,
        byCarrier,
        byYear,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/quotes/list
http.route({
  path: "/mcp/quotes/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const quotes = await ctx.runQuery(internal.quotes.listAllInternal, {
        orgId: identity.orgId as any,
      });

      const carrier = getQueryParam(request, "carrier");
      const year = getQueryParam(request, "year");

      const filtered = quotes.filter((q: any) => {
        if (carrier && q.carrier !== carrier) return false;
        if (year && q.quoteYear !== parseInt(year)) return false;
        return true;
      });

      return jsonResponse(
        filtered.map((q: any) => ({
          _id: q._id,
          carrier: q.carrier,
          security: q.security,
          broker: q.broker,
          quoteNumber: q.quoteNumber,
          policyTypes: q.policyTypes,
          quoteYear: q.quoteYear,
          proposedEffectiveDate: q.proposedEffectiveDate,
          proposedExpirationDate: q.proposedExpirationDate,
          quoteExpirationDate: q.quoteExpirationDate,
          premium: q.premium,
          insuredName: q.insuredName,
          summary: q.summary,
          isRenewal: q.isRenewal,
          coverages: q.coverages,
        })),
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/quotes/get
http.route({
  path: "/mcp/quotes/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const quotes = await ctx.runQuery(internal.quotes.listAllInternal, {
        orgId: identity.orgId as any,
      });
      const found = quotes.find((q: any) => q._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      const { rawExtractionResponse, rawMetadataResponse, ...rest } = found as any;
      return jsonResponse(rest);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/applications/list
http.route({
  path: "/mcp/applications/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const sessions = await ctx.runQuery(
        internal.applicationSessions.listAllInternal,
        { orgId: identity.orgId as any },
      );
      return jsonResponse(sessions);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/applications/get
http.route({
  path: "/mcp/applications/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const session = await ctx.runQuery(
        internal.applicationSessions.getInternal,
        { id: id as any },
      );
      if (!session || (session as any).orgId !== identity.orgId) {
        return jsonResponse({ error: "Not found" }, 404);
      }
      return jsonResponse(session);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/threads/list
http.route({
  path: "/mcp/threads/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const threads = await ctx.runQuery(internal.threads.listByOrg, {
        orgId: identity.orgId as any,
      });
      return jsonResponse(
        threads.map((t: any) => ({
          _id: t._id,
          title: t.title,
          lastMessageAt: t.lastMessageAt,
          archivedAt: t.archivedAt,
          _creationTime: t._creationTime,
        })),
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/threads/messages
http.route({
  path: "/mcp/threads/messages",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const threadId = getQueryParam(request, "threadId");
      if (!threadId) return jsonResponse({ error: "Missing threadId parameter" }, 400);

      // Verify thread belongs to org
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: threadId as any,
      });
      if (!thread || (thread as any).orgId !== identity.orgId) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const messages = await ctx.runQuery(internal.threads.messagesInternal, {
        threadId: threadId as any,
      });
      return jsonResponse(
        messages.map((m: any) => ({
          _id: m._id,
          role: m.role,
          channel: m.channel,
          content: m.content,
          userName: m.userName,
          fromEmail: m.fromEmail,
          _creationTime: m._creationTime,
        })),
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/context/list
http.route({
  path: "/mcp/context/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const entries = await ctx.runQuery(internal.businessContext.listInternal, {
        orgId: identity.orgId as any,
      });
      return jsonResponse(entries);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/org/info
http.route({
  path: "/mcp/org/info",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: identity.orgId as any,
      });
      if (!org) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse({
        _id: org._id,
        name: org.name,
        website: org.website,
        industry: org.industry,
        industryVertical: org.industryVertical,
        context: org.context,
        insuranceBroker: org.insuranceBroker,
        brokerContactName: org.brokerContactName,
        brokerContactEmail: org.brokerContactEmail,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/context/upsert
http.route({
  path: "/mcp/context/upsert",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const body = await request.json();
      const { category, key, value } = body;
      if (!category || !key || !value) {
        return jsonResponse({ error: "Missing required fields: category, key, value" }, 400);
      }

      await ctx.runMutation(internal.businessContext.upsertInternal, {
        orgId: identity.orgId as any,
        category,
        key,
        value,
        source: "manual" as const,
        confidence: "confirmed" as const,
      });
      return jsonResponse({ success: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/applications/cancel
http.route({
  path: "/mcp/applications/cancel",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const body = await request.json();
      const { id } = body;
      if (!id) return jsonResponse({ error: "Missing id" }, 400);

      // Verify org ownership
      const session = await ctx.runQuery(
        internal.applicationSessions.getInternal,
        { id: id as any },
      );
      if (!session || (session as any).orgId !== identity.orgId) {
        return jsonResponse({ error: "Not found" }, 404);
      }
      if (["complete", "cancelled"].includes((session as any).status)) {
        return jsonResponse({ error: "Session already ended" }, 400);
      }

      await ctx.runMutation(internal.applicationSessions.updateStatus, {
        id: id as any,
        status: "cancelled" as const,
      });
      return jsonResponse({ success: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// ── MCP Streamable HTTP Transport ──
// Single endpoint implementing MCP protocol over HTTP for remote clients (Claude.ai, etc.)

const MCP_TOOLS = [
  {
    name: "list_policies",
    description: "List insurance policies. Optionally filter by carrier, year, or policy type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        carrier: { type: "string", description: "Filter by carrier name" },
        year: { type: "string", description: "Filter by policy year (e.g. '2024')" },
        type: { type: "string", description: "Filter by policy type (e.g. 'general_liability', 'cyber')" },
      },
    },
  },
  {
    name: "get_policy",
    description: "Get full details of a specific insurance policy by ID, including coverages, document sections, and metadata.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The policy ID" } },
      required: ["id"],
    },
  },
  {
    name: "search_policies",
    description: "Search across policies by text query. Searches carrier, policy number, insured name, summary, and policy types.",
    inputSchema: {
      type: "object" as const,
      properties: { q: { type: "string", description: "Search query text" } },
      required: ["q"],
    },
  },
  {
    name: "get_policy_stats",
    description: "Get dashboard statistics for policies: total count, breakdown by type, carrier, and year.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_quotes",
    description: "List insurance quotes. Optionally filter by carrier or year.",
    inputSchema: {
      type: "object" as const,
      properties: {
        carrier: { type: "string", description: "Filter by carrier name" },
        year: { type: "string", description: "Filter by quote year (e.g. '2024')" },
      },
    },
  },
  {
    name: "get_quote",
    description: "Get full details of a specific insurance quote by ID, including proposed coverages and terms.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The quote ID" } },
      required: ["id"],
    },
  },
  {
    name: "list_applications",
    description: "List insurance application sessions with their status and progress.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_application",
    description: "Get full details of an application session including extracted fields and question batches.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The application session ID" } },
      required: ["id"],
    },
  },
  {
    name: "list_threads",
    description: "List recent conversation threads (up to 50, newest first).",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_thread_messages",
    description: "Get all messages in a conversation thread.",
    inputSchema: {
      type: "object" as const,
      properties: { threadId: { type: "string", description: "The thread ID" } },
      required: ["threadId"],
    },
  },
  {
    name: "get_business_context",
    description: "Get the organization's stored business context entries used for auto-filling applications.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "update_business_context",
    description: "Create or update a business context entry. Used to store reusable company data for application auto-fill.",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: { type: "string", description: "Category: company_info, operations, financial, coverage, loss_history, or custom" },
        key: { type: "string", description: "Normalized field name (e.g. 'annual_revenue', 'employee_count')" },
        value: { type: "string", description: "The value to store" },
      },
      required: ["category", "key", "value"],
    },
  },
  {
    name: "get_org_info",
    description: "Get organization profile information including name, industry, website, and broker details.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "ask_prism",
    description: "Ask the Prism AI assistant a question about the organization's insurance portfolio, policies, quotes, applications, or coverage details. Prism has full context about all policies and quotes and can answer complex insurance questions. Optionally pass a threadId to continue an existing conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "The question or message to send to Prism" },
        threadId: { type: "string", description: "Optional thread ID to continue an existing conversation" },
      },
      required: ["message"],
    },
  },
];

function jsonRpcResponse(id: string | number | null, result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, result }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function jsonRpcError(id: string | number | null, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { headers: { "Content-Type": "application/json" } },
  );
}

async function handleToolCall(
  ctx: { runQuery: any; runMutation: any; runAction: any },
  identity: ApiKeyIdentity,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const orgId = identity.orgId as any;
  const userId = identity.userId as any;

  switch (name) {
    case "list_policies": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const filtered = policies.filter((p: any) => {
        if (args.carrier && p.carrier !== args.carrier) return false;
        if (args.year && p.policyYear !== parseInt(args.year as string)) return false;
        if (args.type && !(p.policyTypes ?? []).includes(args.type)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map((p: any) => ({
        _id: p._id, carrier: p.carrier, security: p.security, broker: p.broker,
        policyNumber: p.policyNumber, policyTypes: p.policyTypes, policyYear: p.policyYear,
        effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium,
        insuredName: p.insuredName, summary: p.summary, isRenewal: p.isRenewal, coverages: p.coverages,
      })), null, 2) }] };
    }
    case "get_policy": {
      if (!args.id) throw new Error("Missing id parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const found = policies.find((p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");
      const { rawExtractionResponse, rawMetadataResponse, ...rest } = found as any;
      return { content: [{ type: "text", text: JSON.stringify(rest, null, 2) }] };
    }
    case "search_policies": {
      if (!args.q) throw new Error("Missing q parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const query = (args.q as string).toLowerCase();
      const results = policies.filter((p: any) => {
        const searchable = [p.carrier, p.policyNumber, p.insuredName, p.summary, p.security, p.broker, ...(p.policyTypes ?? [])].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(query);
      });
      return { content: [{ type: "text", text: JSON.stringify(results.map((p: any) => ({
        _id: p._id, carrier: p.carrier, policyNumber: p.policyNumber, policyTypes: p.policyTypes,
        policyYear: p.policyYear, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate,
        premium: p.premium, insuredName: p.insuredName, summary: p.summary,
      })), null, 2) }] };
    }
    case "get_policy_stats": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const byType: Record<string, number> = {};
      const byCarrier: Record<string, number> = {};
      const byYear: Record<string, number> = {};
      for (const p of policies) {
        for (const t of ((p as any).policyTypes ?? ["other"])) byType[t] = (byType[t] || 0) + 1;
        byCarrier[(p as any).carrier] = (byCarrier[(p as any).carrier] || 0) + 1;
        byYear[(p as any).policyYear] = (byYear[(p as any).policyYear] || 0) + 1;
      }
      return { content: [{ type: "text", text: JSON.stringify({ totalPolicies: policies.length, byType, byCarrier, byYear }, null, 2) }] };
    }
    case "list_quotes": {
      const quotes = await ctx.runQuery(internal.quotes.listAllInternal, { orgId });
      const filtered = quotes.filter((q: any) => {
        if (args.carrier && q.carrier !== args.carrier) return false;
        if (args.year && q.quoteYear !== parseInt(args.year as string)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map((q: any) => ({
        _id: q._id, carrier: q.carrier, security: q.security, broker: q.broker,
        quoteNumber: q.quoteNumber, policyTypes: q.policyTypes, quoteYear: q.quoteYear,
        proposedEffectiveDate: q.proposedEffectiveDate, proposedExpirationDate: q.proposedExpirationDate,
        quoteExpirationDate: q.quoteExpirationDate, premium: q.premium, insuredName: q.insuredName,
        summary: q.summary, isRenewal: q.isRenewal, coverages: q.coverages,
      })), null, 2) }] };
    }
    case "get_quote": {
      if (!args.id) throw new Error("Missing id parameter");
      const quotes = await ctx.runQuery(internal.quotes.listAllInternal, { orgId });
      const found = quotes.find((q: any) => q._id === args.id);
      if (!found) throw new Error("Not found");
      const { rawExtractionResponse, rawMetadataResponse, ...rest } = found as any;
      return { content: [{ type: "text", text: JSON.stringify(rest, null, 2) }] };
    }
    case "list_applications": {
      const sessions = await ctx.runQuery(internal.applicationSessions.listAllInternal, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
    }
    case "get_application": {
      if (!args.id) throw new Error("Missing id parameter");
      const session = await ctx.runQuery(internal.applicationSessions.getInternal, { id: args.id as any });
      if (!session || (session as any).orgId !== identity.orgId) throw new Error("Not found");
      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
    }
    case "list_threads": {
      const threads = await ctx.runQuery(internal.threads.listByOrg, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(threads.map((t: any) => ({
        _id: t._id, title: t.title, lastMessageAt: t.lastMessageAt, archivedAt: t.archivedAt, _creationTime: t._creationTime,
      })), null, 2) }] };
    }
    case "get_thread_messages": {
      if (!args.threadId) throw new Error("Missing threadId parameter");
      const thread = await ctx.runQuery(internal.threads.getInternal, { id: args.threadId as any });
      if (!thread || (thread as any).orgId !== identity.orgId) throw new Error("Not found");
      const messages = await ctx.runQuery(internal.threads.messagesInternal, { threadId: args.threadId as any });
      return { content: [{ type: "text", text: JSON.stringify(messages.map((m: any) => ({
        _id: m._id, role: m.role, channel: m.channel, content: m.content, userName: m.userName, fromEmail: m.fromEmail, _creationTime: m._creationTime,
      })), null, 2) }] };
    }
    case "get_business_context": {
      const entries = await ctx.runQuery(internal.businessContext.listInternal, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
    case "update_business_context": {
      if (!args.category || !args.key || !args.value) throw new Error("Missing required fields: category, key, value");
      await ctx.runMutation(internal.businessContext.upsertInternal, {
        orgId, category: args.category as string, key: args.key as string,
        value: args.value as string, source: "manual" as const, confidence: "confirmed" as const,
      });
      return { content: [{ type: "text", text: `Updated business context: ${args.category}/${args.key}` }] };
    }
    case "get_org_info": {
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) throw new Error("Not found");
      return { content: [{ type: "text", text: JSON.stringify({
        _id: org._id, name: org.name, website: org.website, industry: org.industry,
        industryVertical: org.industryVertical, context: org.context, insuranceBroker: org.insuranceBroker,
        brokerContactName: org.brokerContactName, brokerContactEmail: org.brokerContactEmail,
      }, null, 2) }] };
    }
    case "ask_prism": {
      if (!args.message) throw new Error("Missing message");
      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId, userId, message: args.message as string,
        threadId: (args.threadId as string) ?? undefined,
      });
      return { content: [{ type: "text", text: `**Thread:** ${result.threadId}\n\n${result.response}` }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const body = await request.json();

      // Handle JSON-RPC 2.0
      const { jsonrpc, id, method, params } = body;
      if (jsonrpc !== "2.0") {
        return jsonRpcError(id ?? null, -32600, "Invalid Request: must be JSON-RPC 2.0");
      }

      // Notifications (no id) return 202
      if (id === undefined || id === null) {
        if (method === "notifications/initialized" || method === "notifications/cancelled") {
          return new Response(null, { status: 202 });
        }
        // Unknown notification
        return new Response(null, { status: 202 });
      }

      switch (method) {
        case "initialize": {
          return jsonRpcResponse(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "prism", version: "1.0.0" },
          });
        }
        case "tools/list": {
          return jsonRpcResponse(id, { tools: MCP_TOOLS });
        }
        case "tools/call": {
          const toolName = params?.name;
          const toolArgs = params?.arguments ?? {};
          if (!toolName) {
            return jsonRpcError(id, -32602, "Missing tool name");
          }
          try {
            const result = await handleToolCall(ctx, identity, toolName, toolArgs);
            return jsonRpcResponse(id, result);
          } catch (toolErr: any) {
            return jsonRpcResponse(id, {
              content: [{ type: "text", text: `Error: ${toolErr.message}` }],
              isError: true,
            });
          }
        }
        default:
          return jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonRpcError(null, -32603, `Internal error: ${String(e)}`);
    }
  }),
});

// Allow DELETE /mcp for session termination (return 200 OK)
http.route({
  path: "/mcp",
  method: "DELETE",
  handler: httpAction(async () => {
    return new Response(null, { status: 200 });
  }),
});

// POST /mcp/ask
http.route({
  path: "/mcp/ask",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiKey(ctx, request);
      const body = await request.json();
      const { message, threadId } = body;
      if (!message) return jsonResponse({ error: "Missing message" }, 400);

      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId: identity.orgId as any,
        userId: identity.userId as any,
        message,
        threadId: threadId ?? undefined,
      });

      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

export default http;
