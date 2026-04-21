import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

// ── OAuth 2.1 Routes ──

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// GET /.well-known/oauth-protected-resource (RFC 9728 — tells MCP clients where to find the auth server)
http.route({
  path: "/.well-known/oauth-protected-resource",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const issuer = url.origin;

    return new Response(
      JSON.stringify({
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: [],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }),
});

// GET /.well-known/oauth-authorization-server
http.route({
  path: "/.well-known/oauth-authorization-server",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const issuer = url.origin;
    const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";

    return new Response(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${siteUrl}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        service_documentation: `${siteUrl}`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }),
});

// OPTIONS /oauth/register (CORS preflight)
http.route({
  path: "/oauth/register",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// POST /oauth/register — Dynamic Client Registration (RFC 7591)
http.route({
  path: "/oauth/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { client_name, redirect_uris, token_endpoint_auth_method } = body;

      if (!client_name || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return new Response(
          JSON.stringify({ error: "invalid_client_metadata", error_description: "client_name and redirect_uris are required" }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }

      // Validate redirect URIs (HTTPS or localhost)
      for (const uri of redirect_uris) {
        try {
          const parsed = new URL(uri);
          const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
          if (parsed.protocol !== "https:" && !isLocalhost) {
            return new Response(
              JSON.stringify({ error: "invalid_redirect_uri", error_description: "Redirect URIs must use HTTPS or localhost" }),
              { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
            );
          }
        } catch {
          return new Response(
            JSON.stringify({ error: "invalid_redirect_uri", error_description: `Invalid URI: ${uri}` }),
            { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
          );
        }
      }

      const result = await ctx.runMutation(internal.oauth.registerClient, {
        clientName: client_name,
        redirectUris: redirect_uris,
        tokenEndpointAuthMethod: token_endpoint_auth_method,
      });

      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "server_error", error_description: String(e) }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
  }),
});

// OPTIONS /oauth/token (CORS preflight)
http.route({
  path: "/oauth/token",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// POST /oauth/token — Token exchange
http.route({
  path: "/oauth/token",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const contentType = request.headers.get("Content-Type") ?? "";
    let params: URLSearchParams;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      params = new URLSearchParams(await request.text());
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      params = new URLSearchParams(body);
    } else {
      params = new URLSearchParams(await request.text());
    }

    const grantType = params.get("grant_type");
    const responseHeaders = { ...CORS_HEADERS, "Content-Type": "application/json" };

    try {
      if (grantType === "authorization_code") {
        const code = params.get("code");
        const clientId = params.get("client_id");
        const redirectUri = params.get("redirect_uri");
        const codeVerifier = params.get("code_verifier");

        if (!code || !clientId || !redirectUri || !codeVerifier) {
          return new Response(
            JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }),
            { status: 400, headers: responseHeaders },
          );
        }

        const result = await ctx.runMutation(internal.oauth.exchangeAuthCode, {
          codeRaw: code,
          clientId,
          redirectUri,
          codeVerifier,
        });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: responseHeaders,
        });
      } else if (grantType === "refresh_token") {
        const refreshToken = params.get("refresh_token");
        const clientId = params.get("client_id");

        if (!refreshToken || !clientId) {
          return new Response(
            JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }),
            { status: 400, headers: responseHeaders },
          );
        }

        const result = await ctx.runMutation(internal.oauth.refreshAccessToken, {
          refreshTokenRaw: refreshToken,
          clientId,
        });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: responseHeaders,
        });
      } else {
        return new Response(
          JSON.stringify({ error: "unsupported_grant_type" }),
          { status: 400, headers: responseHeaders },
        );
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "invalid_grant") {
        return new Response(
          JSON.stringify({ error: "invalid_grant" }),
          { status: 400, headers: responseHeaders },
        );
      }
      return new Response(
        JSON.stringify({ error: "server_error", error_description: message }),
        { status: 500, headers: responseHeaders },
      );
    }
  }),
});

// POST /oauth/revoke — Token revocation
http.route({
  path: "/oauth/revoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rawToken = authHeader.slice(7);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawToken));
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await ctx.runMutation(internal.oauth.revokeTokenInternal, { tokenHash });
    return new Response(null, { status: 200 });
  }),
});

// ── MCP API Routes ──

const JSON_HEADERS = { "Content-Type": "application/json" };

type McpIdentity = {
  userId: string;
  orgId: string;
  source: "api_key" | "oauth";
  keyId?: string;
};

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Authenticate MCP requests. Tries API key first (prism_ prefix), then OAuth token (prsm_at_ prefix).
 * Returns 401 with WWW-Authenticate: Bearer when no auth (triggers OAuth flow in MCP clients).
 */
async function requireMcpAuth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { runQuery: (...args: any[]) => Promise<any>; runMutation: (...args: any[]) => Promise<any> },
  request: Request,
): Promise<McpIdentity> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response(
      JSON.stringify({ error: "unauthorized" }),
      {
        status: 401,
        headers: {
          ...JSON_HEADERS,
          "WWW-Authenticate": 'Bearer resource_metadata="/.well-known/oauth-authorization-server"',
        },
      },
    );
  }

  const rawToken = authHeader.slice(7);

  // Try API key auth (prism_ prefix)
  if (rawToken.startsWith("prism_")) {
    const keyHash = await sha256Hex(rawToken);
    const result = await ctx.runQuery(internal.apiKeys.validateKey, { keyHash });
    if (!result) {
      throw new Response("Invalid or revoked API key", {
        status: 403,
        headers: JSON_HEADERS,
      });
    }
    await ctx.runMutation(internal.apiKeys.touchLastUsed, { id: result.keyId });
    return { ...result, source: "api_key" };
  }

  // Try OAuth token auth (prsm_at_ prefix)
  if (rawToken.startsWith("prsm_at_")) {
    const tokenHash = await sha256Hex(rawToken);
    const result = await ctx.runQuery(internal.oauth.validateAccessToken, {
      tokenHash,
    });
    if (!result) {
      throw new Response("Invalid or expired token", {
        status: 401,
        headers: {
          ...JSON_HEADERS,
          "WWW-Authenticate": 'Bearer error="invalid_token"',
        },
      });
    }
    return {
      userId: result.userId,
      orgId: result.orgId,
      source: "oauth",
    };
  }

  throw new Response("Invalid token format", {
    status: 401,
    headers: {
      ...JSON_HEADERS,
      "WWW-Authenticate": 'Bearer resource_metadata="/.well-known/oauth-authorization-server"',
    },
  });
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
      const identity = await requireMcpAuth(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });

      // Apply optional filters from query params
      const carrier = getQueryParam(request, "carrier");
      const year = getQueryParam(request, "year");
      const type = getQueryParam(request, "type");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered = policies.filter((p: any) => {
        if (carrier && p.carrier !== carrier) return false;
        if (year && p.policyYear !== parseInt(year)) return false;
        if (type && !(p.policyTypes ?? []).includes(type)) return false;
        return true;
      });

      // Return lightweight summaries
      return jsonResponse(
        filtered.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const policy = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });
      const found = policy.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      // Return full detail (excluding raw extraction responses)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawExtractionResponse: _rawExtractionResponse, rawMetadataResponse: _rawMetadataResponse, ...rest } = found;
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
      const identity = await requireMcpAuth(ctx, request);
      const q = getQueryParam(request, "q");
      if (!q) return jsonResponse({ error: "Missing q parameter" }, 400);

      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });

      const query = q.toLowerCase();
      const results = policies.filter(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => {
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
        results.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });

      const byType: Record<string, number> = {};
      const byCarrier: Record<string, number> = {};
      const byYear: Record<string, number> = {};

      for (const p of policies) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pa = p as any;
        const types = pa.policyTypes ?? ["other"];
        for (const t of types) {
          byType[t] = (byType[t] || 0) + 1;
        }
        byCarrier[pa.carrier] = (byCarrier[pa.carrier] || 0) + 1;
        byYear[pa.policyYear] = (byYear[pa.policyYear] || 0) + 1;
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
      const identity = await requireMcpAuth(ctx, request);
      const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });

      const carrier = getQueryParam(request, "carrier");
      const year = getQueryParam(request, "year");

      const filtered = quotes.filter(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => {
        if (carrier && q.carrier !== carrier) return false;
        if (year && q.policyYear !== parseInt(year)) return false;
        return true;
      });

      return jsonResponse(
        filtered.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });
      const found = quotes.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => q._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawExtractionResponse: _rawExtractionResponse, rawMetadataResponse: _rawMetadataResponse, ...rest } = found as any;
      return jsonResponse(rest);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/applications/list — legacy endpoint (applicationSessions retired)
http.route({
  path: "/mcp/applications/list",
  method: "GET",
  handler: httpAction(async (_ctx, _request) => {
    return jsonResponse({ error: "applicationSessions retired — use applications v2 API" }, 410);
  }),
});

// GET /mcp/applications/get — legacy endpoint (applicationSessions retired)
http.route({
  path: "/mcp/applications/get",
  method: "GET",
  handler: httpAction(async (_ctx, _request) => {
    return jsonResponse({ error: "applicationSessions retired — use applications v2 API" }, 410);
  }),
});

// GET /mcp/threads/list
http.route({
  path: "/mcp/threads/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const threads = await ctx.runQuery(internal.threads.listByOrg, {
        orgId: identity.orgId as Id<"organizations">,
      });
      return jsonResponse(
        threads.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(t: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
      const threadId = getQueryParam(request, "threadId");
      if (!threadId) return jsonResponse({ error: "Missing threadId parameter" }, 400);

      // Verify thread belongs to org
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: threadId as Id<"threads">,
      });
      if (!thread || (thread as Record<string, unknown>).orgId !== identity.orgId) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const messages = await ctx.runQuery(internal.threads.messagesInternal, {
        threadId: threadId as Id<"threads">,
      });
      return jsonResponse(
        messages.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(m: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
      const entries = await ctx.runQuery(internal.businessContext.listInternal, {
        orgId: identity.orgId as Id<"organizations">,
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
      const identity = await requireMcpAuth(ctx, request);
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: identity.orgId as Id<"organizations">,
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
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      const { category, key, value } = body;
      if (!category || !key || !value) {
        return jsonResponse({ error: "Missing required fields: category, key, value" }, 400);
      }

      await ctx.runMutation(internal.businessContext.upsertInternal, {
        orgId: identity.orgId as Id<"organizations">,
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

// POST /mcp/applications/cancel — legacy endpoint (applicationSessions retired)
http.route({
  path: "/mcp/applications/cancel",
  method: "POST",
  handler: httpAction(async (_ctx, _request) => {
    return jsonResponse({ error: "applicationSessions retired — use applications v2 API" }, 410);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { runQuery: (...args: any[]) => Promise<any>; runMutation: (...args: any[]) => Promise<any>; runAction: (...args: any[]) => Promise<any> },
  identity: McpIdentity,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const orgId = identity.orgId as Id<"organizations">;
  const userId = identity.userId as Id<"users">;

  switch (name) {
    case "list_policies": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const filtered = policies.filter(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => {
        if (args.carrier && p.carrier !== args.carrier) return false;
        if (args.year && p.policyYear !== parseInt(args.year as string)) return false;
        if (args.type && !(p.policyTypes ?? []).includes(args.type)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => ({
        _id: p._id, carrier: p.carrier, security: p.security, broker: p.broker,
        policyNumber: p.policyNumber, policyTypes: p.policyTypes, policyYear: p.policyYear,
        effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium,
        insuredName: p.insuredName, summary: p.summary, isRenewal: p.isRenewal, coverages: p.coverages,
      })), null, 2) }] };
    }
    case "get_policy": {
      if (!args.id) throw new Error("Missing id parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const found = policies.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawExtractionResponse: _rawExtractionResponse, rawMetadataResponse: _rawMetadataResponse, ...rest } = found as any;
      return { content: [{ type: "text", text: JSON.stringify(rest, null, 2) }] };
    }
    case "search_policies": {
      if (!args.q) throw new Error("Missing q parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const query = (args.q as string).toLowerCase();
      const results = policies.filter(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => {
        const searchable = [p.carrier, p.policyNumber, p.insuredName, p.summary, p.security, p.broker, ...(p.policyTypes ?? [])].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(query);
      });
      return { content: [{ type: "text", text: JSON.stringify(results.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(p: any) => ({
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pa = p as any;
        for (const t of (pa.policyTypes ?? ["other"])) byType[t] = (byType[t] || 0) + 1;
        byCarrier[pa.carrier] = (byCarrier[pa.carrier] || 0) + 1;
        byYear[pa.policyYear] = (byYear[pa.policyYear] || 0) + 1;
      }
      return { content: [{ type: "text", text: JSON.stringify({ totalPolicies: policies.length, byType, byCarrier, byYear }, null, 2) }] };
    }
    case "list_quotes": {
      const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, { orgId });
      const filtered = quotes.filter(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => {
        if (args.carrier && q.carrier !== args.carrier) return false;
        if (args.year && q.policyYear !== parseInt(args.year as string)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => ({
        _id: q._id, carrier: q.carrier, security: q.security, broker: q.broker,
        quoteNumber: q.quoteNumber, policyTypes: q.policyTypes, quoteYear: q.quoteYear,
        proposedEffectiveDate: q.proposedEffectiveDate, proposedExpirationDate: q.proposedExpirationDate,
        quoteExpirationDate: q.quoteExpirationDate, premium: q.premium, insuredName: q.insuredName,
        summary: q.summary, isRenewal: q.isRenewal, coverages: q.coverages,
      })), null, 2) }] };
    }
    case "get_quote": {
      if (!args.id) throw new Error("Missing id parameter");
      const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, { orgId });
      const found = quotes.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(q: any) => q._id === args.id);
      if (!found) throw new Error("Not found");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawExtractionResponse: _rawExtractionResponse, rawMetadataResponse: _rawMetadataResponse, ...rest } = found as any;
      return { content: [{ type: "text", text: JSON.stringify(rest, null, 2) }] };
    }
    case "list_applications": {
      // applicationSessions retired — return empty list
      return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
    }
    case "get_application": {
      // applicationSessions retired
      throw new Error("applicationSessions retired — use applications v2 API");
    }
    case "list_threads": {
      const threads = await ctx.runQuery(internal.threads.listByOrg, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(threads.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(t: any) => ({
        _id: t._id, title: t.title, lastMessageAt: t.lastMessageAt, archivedAt: t.archivedAt, _creationTime: t._creationTime,
      })), null, 2) }] };
    }
    case "get_thread_messages": {
      if (!args.threadId) throw new Error("Missing threadId parameter");
      const thread = await ctx.runQuery(internal.threads.getInternal, { id: args.threadId as Id<"threads"> });
      if (!thread || (thread as Record<string, unknown>).orgId !== identity.orgId) throw new Error("Not found");
      const messages = await ctx.runQuery(internal.threads.messagesInternal, { threadId: args.threadId as Id<"threads"> });
      return { content: [{ type: "text", text: JSON.stringify(messages.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(m: any) => ({
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
      const identity = await requireMcpAuth(ctx, request);
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
          const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";
          return jsonRpcResponse(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: {
              name: "Prism",
              version: "1.0.0",
              icons: [
                {
                  src: `${siteUrl}/prism-icon.svg`,
                  mimeType: "image/svg+xml",
                  sizes: ["any"],
                },
                {
                  src: `${siteUrl}/logo-bimi.svg`,
                  mimeType: "image/svg+xml",
                  sizes: ["any"],
                  theme: "light",
                },
              ],
            },
            instructions: "Prism is an insurance intelligence platform. Use Prism tools to look up policies, quotes, applications, and business context for the connected organization. Use ask_prism for complex insurance questions.",
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
          } catch (toolErr: unknown) {
            return jsonRpcResponse(id, {
              content: [{ type: "text", text: `Error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}` }],
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
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      const { message, threadId } = body;
      if (!message) return jsonResponse({ error: "Missing message" }, 400);

      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId: identity.orgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
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
