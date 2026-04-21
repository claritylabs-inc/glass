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
  scopes?: ("read" | "write")[];
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
    const result = await ctx.runQuery(
      (internal as any).oauth.validateAccessTokenWithScopes,
      { tokenHash },
    );
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
      scopes: result.scopes ?? ["read"],
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
    description: "Alias for ask_glass (legacy name). Ask the Glass AI assistant a question about the organization's insurance portfolio.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "The question or message to send to Glass" },
        threadId: { type: "string", description: "Optional thread ID to continue an existing conversation" },
      },
      required: ["message"],
    },
  },
  {
    name: "ask_glass",
    description: "Ask the Glass AI assistant a question about the organization's insurance portfolio, policies, quotes, applications, or coverage details. Glass has full context about all policies and quotes and can answer complex insurance questions. Optionally pass a threadId to continue an existing conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "The question or message to send to Glass" },
        threadId: { type: "string", description: "Optional thread ID to continue an existing conversation" },
      },
      required: ["message"],
    },
  },
  // ── Broker tools ──
  {
    name: "list_clients",
    description: "List clients visible to the broker. Broker only.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_client",
    description: "Get passport summary and policy count for a client org. Broker only.",
    inputSchema: {
      type: "object" as const,
      properties: { client_org_id: { type: "string", description: "Client org ID" } },
      required: ["client_org_id"],
    },
  },
  {
    name: "list_applications_for_client",
    description: "List applications for a specific client. Broker only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_org_id: { type: "string", description: "Client org ID" },
        status: { type: "string", description: "Optional status filter" },
      },
      required: ["client_org_id"],
    },
  },
  {
    name: "create_application_draft",
    description: "Create a new application draft for a client. Broker only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_org_id: { type: "string" },
        creation_path: { type: "string", enum: ["blank", "template", "upload"] },
        title: { type: "string" },
        line_of_business: { type: "string" },
      },
      required: ["client_org_id", "creation_path", "title"],
    },
  },
  {
    name: "add_application_question",
    description: "Add a question to a draft application. Broker only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        application_id: { type: "string" },
        intent_key: { type: "string" },
        custom_prompt: { type: "string" },
        answer_type: { type: "string" },
        required: { type: "boolean" },
      },
      required: ["application_id"],
    },
  },
  {
    name: "send_application",
    description: "Send an application to a client. Broker only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: { application_id: { type: "string" } },
      required: ["application_id"],
    },
  },
  {
    name: "raise_passport_flag",
    description: "Raise a flag on a client passport field. Broker only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_org_id: { type: "string" },
        field_path: { type: "string" },
        message: { type: "string" },
      },
      required: ["client_org_id", "field_path", "message"],
    },
  },
  {
    name: "list_broker_activity",
    description: "List broker portfolio activity feed.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  // ── Client tools ──
  {
    name: "get_passport",
    description: "Get the full passport for the caller's client org. Client only.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "update_passport",
    description: "Update passport fields. Client only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: { patch: { type: "object", description: "Fields to update (snake_case)" } },
      required: ["patch"],
    },
  },
  {
    name: "answer_application_question",
    description: "Upsert an answer to an application question. Client only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        application_id: { type: "string" },
        question_id: { type: "string" },
        row_key: { type: "string" },
        value: {},
      },
      required: ["application_id", "question_id", "value"],
    },
  },
  {
    name: "submit_application_section",
    description: "Submit a section of an application for broker review. Client only. Write scope required.",
    inputSchema: {
      type: "object" as const,
      properties: { application_id: { type: "string" }, group_id: { type: "string" } },
      required: ["application_id", "group_id"],
    },
  },
  {
    name: "list_my_policies",
    description: "List policies for the caller's client org. Client only.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

function requireWriteScope(identity: McpIdentity): void {
  const scopes = identity.scopes ?? ["read"];
  if (!scopes.includes("write")) {
    throw new Error("insufficient_scope: this tool requires write scope");
  }
}

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
    case "ask_prism":
    case "ask_glass": {
      if (!args.message) throw new Error("Missing message");
      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId, userId, message: args.message as string,
        threadId: (args.threadId as string) ?? undefined,
      });
      return { content: [{ type: "text", text: `**Thread:** ${result.threadId}\n\n${result.response}` }] };
    }
    // ── Broker tools ──
    case "list_clients": {
      const clients = await ctx.runQuery((internal as any).clients.listForBroker, { brokerOrgId: orgId });
      return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
    }
    case "get_client": {
      const clientOrgId = args.client_org_id as Id<"organizations">;
      const clientOrg = await ctx.runQuery(internal.orgs.getInternal, { id: clientOrgId });
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId });
      return { content: [{ type: "text", text: JSON.stringify({ org: clientOrg, policy_count: policies.length }, null, 2) }] };
    }
    case "list_applications_for_client": {
      const clientOrgId = args.client_org_id as Id<"organizations">;
      const apps = await ctx.runQuery((internal as any).applications.listForOrg, {
        orgId: clientOrgId, userId, cursor: undefined, limit: 50,
      });
      return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
    }
    case "create_application_draft": {
      requireWriteScope(identity);
      const appId = await ctx.runMutation((internal as any).applications.createDraft, {
        brokerOrgId: orgId, clientOrgId: args.client_org_id as Id<"organizations">,
        creationPath: args.creation_path, title: args.title, lineOfBusiness: args.line_of_business,
      });
      return { content: [{ type: "text", text: JSON.stringify({ id: appId }, null, 2) }] };
    }
    case "add_application_question": {
      requireWriteScope(identity);
      const qId = await ctx.runMutation((internal as any).applications.addQuestion, {
        applicationId: args.application_id as Id<"applications">,
        brokerOrgId: orgId, intentKey: args.intent_key,
        customPrompt: args.custom_prompt, answerType: args.answer_type ?? "text",
        required: args.required ?? false,
      });
      return { content: [{ type: "text", text: JSON.stringify({ id: qId }, null, 2) }] };
    }
    case "send_application": {
      requireWriteScope(identity);
      await ctx.runMutation((internal as any).applications.send, {
        applicationId: args.application_id as Id<"applications">, brokerOrgId: orgId,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
    }
    case "raise_passport_flag": {
      requireWriteScope(identity);
      const flagId = await ctx.runMutation((internal as any).passportFieldFlags.raise, {
        clientOrgId: args.client_org_id as Id<"organizations">, brokerOrgId: orgId,
        fieldPath: args.field_path, message: args.message,
      });
      return { content: [{ type: "text", text: JSON.stringify({ id: flagId }, null, 2) }] };
    }
    case "list_broker_activity": {
      const activity = await ctx.runQuery((internal as any).brokerActivity.listPortfolio, {
        orgId, limit: 50,
      }).catch(() => []);
      return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
    }
    // ── Client tools ──
    case "get_passport": {
      const passport = await ctx.runQuery((internal as any).clientPassport.getFull, { orgId }).catch(() => null);
      if (!passport) throw new Error("not_found: passport not found");
      return { content: [{ type: "text", text: JSON.stringify(passport, null, 2) }] };
    }
    case "update_passport": {
      requireWriteScope(identity);
      const patch = args.patch as Record<string, any>;
      const convexPatch: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "legal_name") convexPatch.legalName = v;
        else if (k === "full_time_employees") convexPatch.fullTimeEmployees = v;
        else if (k === "annual_revenue") convexPatch.annualRevenue = v;
        else convexPatch[k] = v;
      }
      await ctx.runMutation((internal as any).clientPassport.upsertCoreInternal, { orgId, ...convexPatch });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
    }
    case "answer_application_question": {
      requireWriteScope(identity);
      await ctx.runMutation((internal as any).applications.upsertAnswer, {
        applicationId: args.application_id as Id<"applications">,
        clientOrgId: orgId,
        questionId: args.question_id as Id<"applicationQuestions">,
        rowKey: args.row_key, value: args.value,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
    }
    case "submit_application_section": {
      requireWriteScope(identity);
      await ctx.runMutation((internal as any).applications.submitGroup, {
        applicationId: args.application_id as Id<"applications">,
        groupId: args.group_id as Id<"applicationGroups">,
        clientOrgId: orgId,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
    }
    case "list_my_policies": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(policies.map((p: any) => ({
        _id: p._id, carrier: p.carrier, policyNumber: p.policyNumber,
        policyTypes: p.policyTypes, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium,
      })), null, 2) }] };
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
          const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";
          return jsonRpcResponse(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: {
              name: "Glass",
              version: "2.0.0",
              icons: [
                {
                  src: `${siteUrl}/glass-icon.svg`,
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
            instructions: "Glass is an insurance intelligence platform. Use Glass tools to look up policies, quotes, applications, passport data, and broker-client workflows. Use ask_glass for complex insurance questions.",
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

// ── Task 16: MCP HTTP backing routes for broker + client tool calls ──

// GET /mcp/broker/clients/list
http.route({
  path: "/mcp/broker/clients/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const result = await ctx.runQuery((internal as any).clients.listForBroker, {
        brokerOrgId: identity.orgId as Id<"organizations">,
      });
      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/broker/clients/get
http.route({
  path: "/mcp/broker/clients/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const clientOrgId = getQueryParam(request, "clientOrgId");
      if (!clientOrgId) return jsonResponse({ error: "Missing clientOrgId" }, 400);
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: clientOrgId as Id<"organizations"> });
      if (!org) return jsonResponse({ error: "Not found" }, 404);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId as Id<"organizations"> });
      return jsonResponse({ org, policy_count: policies.length });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/broker/applications/list
http.route({
  path: "/mcp/broker/applications/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const clientOrgId = getQueryParam(request, "clientOrgId");
      if (!clientOrgId) return jsonResponse({ error: "Missing clientOrgId" }, 400);
      const result = await ctx.runQuery((internal as any).applications.listForOrg, {
        orgId: clientOrgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
        cursor: undefined,
        limit: 50,
      });
      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/broker/applications/create
http.route({
  path: "/mcp/broker/applications/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      const { clientOrgId, creationPath, title, lineOfBusiness } = body;
      if (!clientOrgId || !creationPath || !title) return jsonResponse({ error: "Missing required fields" }, 400);
      const appId = await ctx.runMutation((internal as any).applications.createDraft, {
        brokerOrgId: identity.orgId as Id<"organizations">,
        clientOrgId: clientOrgId as Id<"organizations">,
        creationPath, title, lineOfBusiness,
      });
      return jsonResponse({ id: appId }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/broker/applications/add-question
http.route({
  path: "/mcp/broker/applications/add-question",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      if (!body.applicationId) return jsonResponse({ error: "Missing applicationId" }, 400);
      const qId = await ctx.runMutation((internal as any).applications.addQuestion, {
        applicationId: body.applicationId as Id<"applications">,
        brokerOrgId: identity.orgId as Id<"organizations">,
        intentKey: body.intentKey,
        customPrompt: body.customPrompt,
        answerType: body.answerType ?? "text",
        required: body.required ?? false,
      });
      return jsonResponse({ id: qId }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/broker/applications/send
http.route({
  path: "/mcp/broker/applications/send",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      if (!body.applicationId) return jsonResponse({ error: "Missing applicationId" }, 400);
      await ctx.runMutation((internal as any).applications.send, {
        applicationId: body.applicationId as Id<"applications">,
        brokerOrgId: identity.orgId as Id<"organizations">,
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/broker/passport/raise-flag
http.route({
  path: "/mcp/broker/passport/raise-flag",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      const { clientOrgId, fieldPath, message } = body;
      if (!clientOrgId || !fieldPath || !message) return jsonResponse({ error: "Missing required fields" }, 400);
      const flagId = await ctx.runMutation((internal as any).passportFieldFlags.raise, {
        clientOrgId: clientOrgId as Id<"organizations">,
        brokerOrgId: identity.orgId as Id<"organizations">,
        fieldPath, message,
      });
      return jsonResponse({ id: flagId }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/broker/activity/list
http.route({
  path: "/mcp/broker/activity/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const result = await ctx.runQuery((internal as any).brokerActivity.listPortfolio, {
        orgId: identity.orgId as Id<"organizations">,
        limit: 50,
      }).catch(() => []);
      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/client/passport/get
http.route({
  path: "/mcp/client/passport/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const passport = await ctx.runQuery((internal as any).clientPassport.getFull, { orgId: identity.orgId as Id<"organizations"> }).catch(() => null);
      if (!passport) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse(passport);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/client/passport/update
http.route({
  path: "/mcp/client/passport/update",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      if (!body.patch) return jsonResponse({ error: "Missing patch" }, 400);
      await ctx.runMutation((internal as any).clientPassport.upsertCoreInternal, {
        orgId: identity.orgId as Id<"organizations">,
        ...body.patch,
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/client/applications/answer
http.route({
  path: "/mcp/client/applications/answer",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      if (!body.applicationId || !body.questionId || body.value === undefined) {
        return jsonResponse({ error: "Missing required fields" }, 400);
      }
      await ctx.runMutation((internal as any).applications.upsertAnswer, {
        applicationId: body.applicationId as Id<"applications">,
        clientOrgId: identity.orgId as Id<"organizations">,
        questionId: body.questionId as Id<"applicationQuestions">,
        rowKey: body.rowKey,
        value: body.value,
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/client/applications/submit-section
http.route({
  path: "/mcp/client/applications/submit-section",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const body = await request.json();
      if (!body.applicationId || !body.groupId) return jsonResponse({ error: "Missing required fields" }, 400);
      await ctx.runMutation((internal as any).applications.submitGroup, {
        applicationId: body.applicationId as Id<"applications">,
        groupId: body.groupId as Id<"applicationGroups">,
        clientOrgId: identity.orgId as Id<"organizations">,
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// ── REST API v1 helpers ──

function extractBearerToken(request: Request): string {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7);
}

async function requireApiAuth(
  ctx: { runQuery: (...args: any[]) => Promise<any>; runMutation: (...args: any[]) => Promise<any> },
  request: Request,
): Promise<{ userId: Id<"users">; orgId: Id<"organizations">; scopes: ("read" | "write")[]; tokenId: Id<"oauthTokens">; requestId: string }> {
  const requestId = crypto.randomUUID();
  const rawToken = extractBearerToken(request);
  if (!rawToken) {
    throw jsonResponse({ error: { code: "unauthorized", message: "Missing bearer token", request_id: requestId } }, 401);
  }
  const orgIdHeader = request.headers.get("x-org-id") ?? request.headers.get("X-Org-Id") ?? "";

  // API key path
  if (rawToken.startsWith("prism_") || rawToken.startsWith("glass_")) {
    const keyHash = await sha256Hex(rawToken);
    const result = await ctx.runQuery(internal.apiKeys.validateKey, { keyHash });
    if (!result) {
      throw jsonResponse({ error: { code: "unauthorized", message: "Invalid or revoked API key", request_id: requestId } }, 401);
    }
    await ctx.runMutation(internal.apiKeys.touchLastUsed, { id: result.keyId });
    // Find a token record for audit log — skip rate limit for API keys, use a sentinel
    return {
      userId: result.userId as Id<"users">,
      orgId: (orgIdHeader || result.orgId) as Id<"organizations">,
      scopes: ["read", "write"],
      tokenId: "sentinel" as Id<"oauthTokens">,
      requestId,
    };
  }

  // OAuth path
  const tokenHash = await sha256Hex(rawToken);
  const tokenData = await ctx.runQuery(
    (internal as any).oauth.validateAccessTokenWithScopes,
    { tokenHash },
  );
  if (!tokenData) {
    throw jsonResponse({ error: { code: "unauthorized", message: "Invalid or expired token", request_id: requestId } }, 401);
  }

  const orgId = (orgIdHeader || tokenData.orgId) as Id<"organizations">;

  return {
    userId: tokenData.userId as Id<"users">,
    orgId,
    scopes: tokenData.scopes ?? ["read"],
    tokenId: tokenData.tokenId as Id<"oauthTokens">,
    requestId,
  };
}

// ── Task 7: GET /api/v1/me ──
http.route({
  path: "/api/v1/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const user = await ctx.runQuery(internal.users.getInternal, { id: identity.userId });
      const orgs = await ctx.runQuery((internal as any).orgs.getOrgsByUserId, { userId: identity.userId }).catch(() => null);
      return jsonResponse({
        user: { id: identity.userId, name: user?.name, email: user?.email },
        accessible_orgs: Array.isArray(orgs) ? orgs.map((o: any) => ({ id: o._id, name: o.name, created_at: o._creationTime, industry: o.industry })) : [],
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/org ──
http.route({
  path: "/api/v1/org",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: identity.orgId });
      if (!org) return jsonResponse({ error: { code: "not_found", message: "Org not found" } }, 404);
      return jsonResponse({ id: org._id, name: org.name, created_at: org._creationTime, industry: org.industry });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── Task 8: GET /api/v1/clients ──
http.route({
  path: "/api/v1/clients",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const result = await ctx.runQuery((internal as any).clients.listForBroker, { brokerOrgId: identity.orgId });
      const data = Array.isArray(result) ? result : (result?.clients ?? []);
      return jsonResponse({ data, next_cursor: result?.nextCursor });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/clients/:id ──
http.route({
  path: "/api/v1/clients/:id",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const clientOrgId = new URL(request.url).pathname.split("/").pop() as Id<"organizations">;
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: clientOrgId });
      if (!org) return jsonResponse({ error: { code: "not_found", message: "Client not found" } }, 404);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId });
      return jsonResponse({ id: org._id, name: org.name, policy_count: policies.length });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── POST /api/v1/clients/invitations ──
http.route({
  path: "/api/v1/clients/invitations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse({ error: { code: "insufficient_scope", message: "Write scope required", request_id: identity.requestId } }, 403);
      }
      const body = await request.json();
      if (!body.client_email) return jsonResponse({ error: { code: "bad_request", message: "Missing client_email" } }, 400);
      const result = await ctx.runMutation((internal as any).clientInvitations.insertInvitation, {
        brokerOrgId: identity.orgId,
        email: body.client_email,
        message: body.message,
      }).catch(() => null);
      return jsonResponse({ ok: true, result }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── Task 9: GET /api/v1/passport ──
http.route({
  path: "/api/v1/passport",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const passport = await ctx.runQuery((internal as any).clientPassport.getFull, { orgId: identity.orgId }).catch(() => null);
      if (!passport) return jsonResponse({ error: { code: "not_found", message: "Passport not found" } }, 404);
      return jsonResponse({
        id: passport._id ?? identity.orgId,
        legal_name: passport.legalName,
        full_time_employees: passport.fullTimeEmployees,
        annual_revenue: passport.annualRevenue,
        created_at: passport._creationTime,
        updated_at: passport.lastUpdated,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── PATCH /api/v1/passport ──
http.route({
  path: "/api/v1/passport",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse({ error: { code: "insufficient_scope", message: "Write scope required", request_id: identity.requestId } }, 403);
      }
      const body = await request.json();
      // Convert snake_case → camelCase
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === "legal_name") patch.legalName = v;
        else if (k === "full_time_employees") patch.fullTimeEmployees = v;
        else if (k === "annual_revenue") patch.annualRevenue = v;
        else patch[k] = v;
      }
      await ctx.runMutation((internal as any).clientPassport.upsertCoreInternal, { orgId: identity.orgId, ...patch });
      return jsonResponse({ ok: true });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── Task 10: GET /api/v1/applications ──
http.route({
  path: "/api/v1/applications",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const limit = Math.min(parseInt(getQueryParam(request, "limit") ?? "50"), 100);
      const cursor = getQueryParam(request, "cursor") ?? undefined;
      const result = await ctx.runQuery((internal as any).applications.listForOrg, {
        orgId: identity.orgId,
        userId: identity.userId,
        cursor,
        limit,
      });
      const data = Array.isArray(result) ? result : (result?.page ?? result?.applications ?? []);
      const nextCursor = result?.continueCursor ?? result?.nextCursor;
      return jsonResponse({ data: data.map((a: any) => ({ id: a._id, title: a.title, status: a.status, created_at: a._creationTime })), next_cursor: nextCursor });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/applications/:id ──
http.route({
  path: "/api/v1/applications/:id",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const appId = new URL(request.url).pathname.split("/").pop() as Id<"applications">;
      const app = await ctx.runQuery((internal as any).applications.getInternal, { id: appId }).catch(() => null);
      if (!app) return jsonResponse({ error: { code: "not_found", message: "Application not found" } }, 404);
      return jsonResponse({ id: app._id, title: app.title, status: app.status, created_at: app._creationTime });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── Task 11: GET /api/v1/policies ──
http.route({
  path: "/api/v1/policies",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: identity.orgId });
      return jsonResponse({
        data: policies.map((p: any) => ({
          id: p._id, carrier: p.carrier, policy_number: p.policyNumber,
          policy_types: p.policyTypes, effective_date: p.effectiveDate,
          expiration_date: p.expirationDate, premium: p.premium, created_at: p._creationTime,
        })),
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/policies/:id ──
http.route({
  path: "/api/v1/policies/:id",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const policyId = new URL(request.url).pathname.split("/").pop() as Id<"policies">;
      const policy = await ctx.runQuery((internal as any).policies.getInternal, { id: policyId }).catch(() =>
        ctx.runQuery(internal.policies.listAllInternal, { orgId: identity.orgId }).then((ps: any[]) => ps.find((p: any) => p._id === policyId))
      );
      if (!policy) return jsonResponse({ error: { code: "not_found", message: "Policy not found" } }, 404);
      return jsonResponse({
        id: policy._id, carrier: policy.carrier, policy_number: policy.policyNumber,
        policy_types: policy.policyTypes, effective_date: policy.effectiveDate,
        expiration_date: policy.expirationDate, premium: policy.premium, created_at: policy._creationTime,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/notifications ──
http.route({
  path: "/api/v1/notifications",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const notifs = await ctx.runQuery((internal as any).notifications.listInternal, {
        orgId: identity.orgId,
        userId: identity.userId,
      }).catch(() => []);
      return jsonResponse({
        data: (Array.isArray(notifs) ? notifs : []).map((n: any) => ({
          id: n._id, type: n.type, message: n.message ?? n.body, read: !!n.read, created_at: n._creationTime,
        })),
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/activity ──
http.route({
  path: "/api/v1/activity",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const result = await ctx.runQuery((internal as any).brokerActivity.listPortfolioInternal, {
        orgId: identity.orgId,
        userId: identity.userId,
      }).catch(() => []);
      return jsonResponse({ data: Array.isArray(result) ? result : [] });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── Task 13: GET /api/v1/openapi.json ──
http.route({
  path: "/api/v1/openapi.json",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const baseUrl = url.origin;
    return jsonResponse({
      openapi: "3.1.0",
      info: { title: "Glass API", version: "1.0.0", description: "Glass insurance intelligence platform REST API" },
      servers: [{ url: baseUrl, description: "Glass API" }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "OAuth2" },
        },
      },
      paths: {
        "/api/v1/me": { get: { tags: ["User"], summary: "Current user + accessible orgs", responses: { "200": { description: "User and org list" } } } },
        "/api/v1/org": { get: { tags: ["Org"], summary: "Current org detail", responses: { "200": { description: "Org detail" } } } },
        "/api/v1/clients": { get: { tags: ["Clients"], summary: "List broker clients", responses: { "200": { description: "Paginated client list" } } } },
        "/api/v1/clients/{id}": { get: { tags: ["Clients"], summary: "Get client detail", responses: { "200": { description: "Client detail" } } } },
        "/api/v1/clients/invitations": { post: { tags: ["Clients"], summary: "Create client invitation (write)", responses: { "201": { description: "Invitation created" } } } },
        "/api/v1/passport": {
          get: { tags: ["Passport"], summary: "Get passport", responses: { "200": { description: "Passport" } } },
          patch: { tags: ["Passport"], summary: "Update passport (write)", responses: { "200": { description: "Updated" } } },
        },
        "/api/v1/applications": { get: { tags: ["Applications"], summary: "List applications", responses: { "200": { description: "Applications" } } } },
        "/api/v1/applications/{id}": { get: { tags: ["Applications"], summary: "Get application", responses: { "200": { description: "Application" } } } },
        "/api/v1/policies": { get: { tags: ["Policies"], summary: "List policies", responses: { "200": { description: "Policies" } } } },
        "/api/v1/policies/{id}": { get: { tags: ["Policies"], summary: "Get policy", responses: { "200": { description: "Policy" } } } },
        "/api/v1/notifications": { get: { tags: ["Notifications"], summary: "List notifications", responses: { "200": { description: "Notifications" } } } },
        "/api/v1/activity": { get: { tags: ["Activity"], summary: "Activity feed", responses: { "200": { description: "Activity" } } } },
      },
    });
  }),
});

// ── GET /.well-known/mcp.json ──
http.route({
  path: "/.well-known/mcp.json",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    return jsonResponse({
      mcpServers: {
        glass: {
          uri: `sse://${url.host}/mcp`,
          instructions: "Glass is an insurance intelligence platform. Use Glass tools to look up policies, quotes, applications, passport data, and broker-client workflows.",
        },
      },
    });
  }),
});

export default http;
