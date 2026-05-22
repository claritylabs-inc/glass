import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { isImessageInboundEnabled } from "./lib/imessageConfig";
import { getAuthSiteUrl, getClientPortalUrl } from "./lib/domains";
import { buildEmailDraftTextSummary } from "./lib/emailDraftSummary";
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

http.route({
  path: "/imessage-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isImessageInboundEnabled()) {
      return new Response(JSON.stringify({ error: "iMessage inbound is not configured" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate shared secret
    const secret = process.env.IMESSAGE_WORKER_SECRET;
    const authHeader = request.headers.get("Authorization") ?? "";
    if (secret && authHeader !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: {
      fromPhone: string;
      messageText: string;
      chatGuid?: string;
      isGroup?: boolean;
      chatTitle?: string;
      participantsUnavailable?: boolean;
      participants?: Array<{ address: string; displayName?: string }>;
      sourceMessageId?: string;
      receivedAt?: number;
      attachments?: Array<{ data: string; mimeType: string; name: string }>;
    };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.fromPhone || !body.messageText) {
      return new Response(JSON.stringify({ error: "fromPhone and messageText are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await ctx.runAction(
        internal.actions.handleInboundImessage.processInbound,
        {
          fromPhone: body.fromPhone,
          messageText: body.messageText,
          chatGuid: body.chatGuid,
          isGroup: body.isGroup,
          chatTitle: body.chatTitle,
          participantsUnavailable: body.participantsUnavailable,
          participants: body.participants,
          sourceMessageId: body.sourceMessageId,
          receivedAt: body.receivedAt,
          attachments: body.attachments,
        },
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[imessage-inbound] Error:", err);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

http.route({
  path: "/cron/connected-email/scan",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.EMAIL_SCAN_CRON_SECRET;
    if (!expectedSecret) {
      return new Response(JSON.stringify({ error: "EMAIL_SCAN_CRON_SECRET is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await ctx.runAction(api.actions.connectedEmail.scanPreviousDay, {
      cronSecret: expectedSecret,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    const siteUrl = getAuthSiteUrl();

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

function mcpResourceMetadataAuthenticateHeader(request: Request): string {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

/**
 * Authenticate MCP requests. Tries API key first (glass_ prefix), then OAuth token (prsm_at_ prefix).
 * Returns 401 with WWW-Authenticate: Bearer when no auth (triggers OAuth flow in MCP clients).
 */
async function requireMcpAuth(

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
          "WWW-Authenticate": mcpResourceMetadataAuthenticateHeader(request),
        },
      },
    );
  }

  const rawToken = authHeader.slice(7);

  // Try API key auth (glass_ prefix)
  if (rawToken.startsWith("glass_")) {
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
          "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"`,
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
      "WWW-Authenticate": mcpResourceMetadataAuthenticateHeader(request),
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

function requireMcpWriteScope(identity: McpIdentity): void {
  if (identity.source === "api_key") return;
  if (!(identity.scopes ?? ["read"]).includes("write")) {
    throw new Error("insufficient_scope: this tool requires write scope");
  }
}

function normalizeCertificateRequest(body: Record<string, unknown>) {
  const certificateHolder =
    typeof body.certificate_holder === "string" ? body.certificate_holder.trim() : "";
  const selectedPartnerProgramId =
    (typeof body.selectedPartnerProgramId === "string" && body.selectedPartnerProgramId.trim()) ||
    (typeof body.partner_program_id === "string" && body.partner_program_id.trim()) ||
    (typeof body.selected_partner_program_id === "string" && body.selected_partner_program_id.trim()) ||
    undefined;
  const holderName =
    (typeof body.holderName === "string" && body.holderName.trim()) ||
    (typeof body.certificate_holder_name === "string" && body.certificate_holder_name.trim()) ||
    certificateHolder.split(/\r?\n/)[0]?.trim() ||
    "";

  return {
    holderName,
    addressLine1:
      (typeof body.addressLine1 === "string" && body.addressLine1.trim()) ||
      (typeof body.address_line_1 === "string" && body.address_line_1.trim()) ||
      certificateHolder.split(/\r?\n/)[1]?.trim() ||
      undefined,
    addressLine2:
      (typeof body.addressLine2 === "string" && body.addressLine2.trim()) ||
      (typeof body.address_line_2 === "string" && body.address_line_2.trim()) ||
      certificateHolder.split(/\r?\n/)[2]?.trim() ||
      undefined,
    city:
      (typeof body.city === "string" && body.city.trim()) ||
      undefined,
    state:
      (typeof body.state === "string" && body.state.trim()) ||
      undefined,
    postalCode:
      (typeof body.postalCode === "string" && body.postalCode.trim()) ||
      (typeof body.postal_code === "string" && body.postal_code.trim()) ||
      undefined,
    selectedPartnerProgramId: selectedPartnerProgramId as Id<"partnerPrograms"> | undefined,
  };
}

function serializeCertificate(certificate: any) {
  return {
    id: certificate._id,
    policy_id: certificate.policyId,
    file_id: certificate.fileId,
    file_name: certificate.fileName,
    certificate_holder: certificate.certificateHolder ?? null,
    certificate_holder_name: certificate.certificateHolderName ?? null,
    source: certificate.source ?? null,
    authority_type: certificate.authorityType ?? "non_binding",
    certification_status: certificate.certificationStatus ?? "not_applicable",
    partner_org_id: certificate.partnerOrgId ?? null,
    partner_program_id: certificate.partnerProgramId ?? null,
    template_id: certificate.templateId ?? null,
    approval_id: certificate.approvalId ?? null,
    standing_authorization_id: certificate.standingAuthorizationId ?? null,
    disclaimer: certificate.disclaimer ?? null,
    created_at: certificate.createdAt,
    url: certificate.url ?? null,
  };
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


      const filtered = policies.filter((p: any) => {
        if (carrier && p.carrier !== carrier) return false;
        if (year && p.policyYear !== parseInt(year)) return false;
        if (type && !(p.policyTypes ?? []).includes(type)) return false;
        return true;
      });

      // Return lightweight summaries
      return jsonResponse(
        filtered.map(
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
      const found = policy.find(
(p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      return jsonResponse(found);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});


// GET /mcp/policies/file
http.route({
  path: "/mcp/policies/file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId as Id<"organizations">,
      });
      const found = policies.find((p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);
      if (!found.fileId) {
        return jsonResponse({ error: "Original policy PDF is not available" }, 404);
      }
      const url = await ctx.storage.getUrl(found.fileId as Id<"_storage">);
      if (!url) return jsonResponse({ error: "Original policy PDF is not available" }, 404);
      return jsonResponse({
        id: found._id,
        file_id: found.fileId,
        file_name: found.fileName ?? `${found.policyNumber ?? "policy"}.pdf`,
        content_type: "application/pdf",
        url,
      });
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
      const results = policies.filter(
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
        results.map(
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

// GET /mcp/policies/certificates/list
http.route({
  path: "/mcp/policies/certificates/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const policyId = getQueryParam(request, "policyId") ?? getQueryParam(request, "policy_id");
      if (!policyId) return jsonResponse({ error: "Missing policyId parameter" }, 400);

      const certificates = await ctx.runQuery(internal.certificates.listByPolicyInternal, {
        orgId: identity.orgId as Id<"organizations">,
        policyId: policyId as Id<"policies">,
      });
      return jsonResponse(certificates.map(serializeCertificate));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/policies/certificates/generate
http.route({
  path: "/mcp/policies/certificates/generate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json() as Record<string, unknown>;
      const policyId = body.policyId ?? body.policy_id;
      if (typeof policyId !== "string" || !policyId) {
        return jsonResponse({ error: "Missing policyId" }, 400);
      }

      const certificate = normalizeCertificateRequest(body);
      if (!certificate.holderName) {
        return jsonResponse({ error: "Missing certificate holder" }, 400);
      }

      const result = await ctx.runAction(internal.certificates.generateForOrg, {
        orgId: identity.orgId as Id<"organizations">,
        policyId: policyId as Id<"policies">,
        ...certificate,
        source: "mcp",
        createdByUserId: identity.userId as Id<"users">,
      });
      return jsonResponse(result, 201);
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

      const filtered = quotes.filter(
(q: any) => {
        if (carrier && q.carrier !== carrier) return false;
        if (year && q.policyYear !== parseInt(year)) return false;
        return true;
      });

      return jsonResponse(
        filtered.map(
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
      const found = quotes.find(
(q: any) => q._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);


      return jsonResponse(found);
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
      const identity = await requireMcpAuth(ctx, request);
      const threads = await ctx.runQuery(internal.threads.listByOrg, {
        orgId: identity.orgId as Id<"organizations">,
      });
      return jsonResponse(
        threads.map(
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
        messages.map(
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
      });
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
    name: "get_policy_pdf",
    description: "Get a temporary download URL for the original full policy PDF document by policy ID.",
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
    name: "list_policy_certificates",
    description: "List generated Certificates of Insurance for a policy, including download URLs and non-binding/certified authority metadata.",
    inputSchema: {
      type: "object" as const,
      properties: { policyId: { type: "string", description: "The policy ID" } },
      required: ["policyId"],
    },
  },
  {
    name: "generate_policy_certificate",
    description: "Generate a Certificate of Insurance PDF for a policy. Returns non-binding/certified authority metadata or a pending approval request. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: { type: "string", description: "The policy ID" },
        holderName: { type: "string", description: "Certificate holder name" },
        addressLine1: { type: "string", description: "Certificate holder street address" },
        addressLine2: { type: "string", description: "Suite, floor, or attention line" },
        city: { type: "string", description: "Certificate holder city" },
        state: { type: "string", description: "Certificate holder state" },
        postalCode: { type: "string", description: "Certificate holder ZIP or postal code" },
      },
      required: ["policyId", "holderName"],
    },
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
    name: "get_org_info",
    description: "Get organization profile information including name, industry, website, and broker details.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "ask_glass",
    description: "Alias for ask_glass (legacy name). Ask the Glass AI assistant a question about the organization's insurance portfolio. When the selected org is a broker workspace, Glass can answer across managed client organizations with client-labeled results.",
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
    description: "Ask the Glass AI assistant a question about the organization's insurance portfolio, policies, quotes, or coverage details. For client orgs, Glass answers within that org; for broker workspaces, Glass can answer across managed clients with client-labeled results. Optionally pass a threadId to continue an existing conversation.",
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
    name: "list_email_drafts",
    description: "List durable outbound email drafts for the organization. Returns a compact text summary by default, with a sample and draft IDs. Optionally filter by threadId or set showAll to see every draft.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Optional thread ID" },
        showAll: { type: "boolean", description: "Show every draft instead of a short sample" },
      },
    },
  },
  {
    name: "draft_email",
    description: "Create a durable outbound email draft using the same Glass email artifact used by web chat. Requires write scope. Returns a draft ID that can be updated, sent, or cancelled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Optional thread ID to attach the draft to" },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "array", items: { type: "string" }, description: "CC email addresses" },
        bcc: { type: "array", items: { type: "string" }, description: "BCC email addresses" },
        originalPolicyIds: { type: "array", items: { type: "string" }, description: "Policy IDs whose original full policy PDFs should be attached" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "update_email_draft",
    description: "Update an existing durable outbound email draft in place. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: { type: "string", description: "Draft ID returned by draft_email or list_email_drafts" },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "array", items: { type: "string" }, description: "CC email addresses" },
        bcc: { type: "array", items: { type: "string" }, description: "BCC email addresses" },
        originalPolicyIds: { type: "array", items: { type: "string" }, description: "Policy IDs whose original full policy PDFs should be attached" },
      },
      required: ["draftId", "to", "subject", "body"],
    },
  },
  {
    name: "send_email_draft",
    description: "Send a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: { type: "string", description: "Draft ID returned by draft_email or list_email_drafts" },
      },
      required: ["draftId"],
    },
  },
  {
    name: "send_email_drafts",
    description: "Send multiple durable outbound email drafts in one batch. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftIds: {
          type: "array",
          items: { type: "string" },
          description: "Draft IDs returned by list_email_drafts",
        },
      },
      required: ["draftIds"],
    },
  },
  {
    name: "cancel_email_draft",
    description: "Cancel a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: { type: "string", description: "Draft ID returned by draft_email or list_email_drafts" },
      },
      required: ["draftId"],
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
    description: "Get client org info and policy count. Broker only.",
    inputSchema: {
      type: "object" as const,
      properties: { client_org_id: { type: "string", description: "Client org ID" } },
      required: ["client_org_id"],
    },
  },
  {
    name: "list_broker_activity",
    description: "List broker portfolio activity feed.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_connected_vendors",
    description: "List vendor organizations that have approved read-only insurance access for the caller's org.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_connected_vendor",
    description: "Get a connected vendor org profile and policy count.",
    inputSchema: {
      type: "object" as const,
      properties: { vendor_org_id: { type: "string", description: "Connected vendor org ID" } },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_connected_vendor_policies",
    description: "List policies for a connected vendor org that approved access.",
    inputSchema: {
      type: "object" as const,
      properties: { vendor_org_id: { type: "string", description: "Connected vendor org ID" } },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_my_policies",
    description: "List policies for the caller's client org. Client only.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_insurance_requirements",
    description: "List the caller org's insurance compliance requirements, including source document provenance when available.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_insurance_requirement",
    description: "Create an insurance compliance requirement for contractors/vendors. Requires write scope and org admin role. For extracted lease/contract requirements, include source_document_name/source_excerpt when available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short requirement title" },
        category: { type: "string", description: "general_liability, auto, workers_comp, umbrella, professional, cyber, property, or other" },
        requirement_text: { type: "string", description: "Plain-language requirement to check against policy data" },
        source_document_name: { type: "string", description: "Optional lease, contract, or requirement packet name" },
        source_excerpt: { type: "string", description: "Optional exact original source language supporting the requirement" },
      },
      required: ["title", "category", "requirement_text"],
    },
  },
  {
    name: "list_vendor_compliance",
    description: "List connected vendor compliance status against the caller org's insurance requirements.",
    inputSchema: { type: "object" as const, properties: {} },
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

  ctx: { runQuery: (...args: any[]) => Promise<any>; runMutation: (...args: any[]) => Promise<any>; runAction: (...args: any[]) => Promise<any>; storage: { getUrl: (storageId: Id<"_storage">) => Promise<string | null> } },
  identity: McpIdentity,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const orgId = identity.orgId as Id<"organizations">;
  const userId = identity.userId as Id<"users">;

  switch (name) {
    case "list_policies": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const filtered = policies.filter(
(p: any) => {
        if (args.carrier && p.carrier !== args.carrier) return false;
        if (args.year && p.policyYear !== parseInt(args.year as string)) return false;
        if (args.type && !(p.policyTypes ?? []).includes(args.type)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map(
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
      const found = policies.find(
(p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");

      return { content: [{ type: "text", text: JSON.stringify(found, null, 2) }] };
    }
    case "get_policy_pdf": {
      if (!args.id) throw new Error("Missing id parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const found = policies.find((p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");
      if (!found.fileId) throw new Error("Original policy PDF is not available");
      const url = await ctx.storage.getUrl(found.fileId as Id<"_storage">);
      if (!url) throw new Error("Original policy PDF is not available");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: found._id,
            file_id: found.fileId,
            file_name: found.fileName ?? `${found.policyNumber ?? "policy"}.pdf`,
            content_type: "application/pdf",
            url,
          }, null, 2),
        }],
      };
    }
    case "search_policies": {
      if (!args.q) throw new Error("Missing q parameter");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      const query = (args.q as string).toLowerCase();
      const results = policies.filter(
(p: any) => {
        const searchable = [p.carrier, p.policyNumber, p.insuredName, p.summary, p.security, p.broker, ...(p.policyTypes ?? [])].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(query);
      });
      return { content: [{ type: "text", text: JSON.stringify(results.map(
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

        const pa = p as any;
        for (const t of (pa.policyTypes ?? ["other"])) byType[t] = (byType[t] || 0) + 1;
        byCarrier[pa.carrier] = (byCarrier[pa.carrier] || 0) + 1;
        byYear[pa.policyYear] = (byYear[pa.policyYear] || 0) + 1;
      }
      return { content: [{ type: "text", text: JSON.stringify({ totalPolicies: policies.length, byType, byCarrier, byYear }, null, 2) }] };
    }
    case "list_policy_certificates": {
      const policyId = args.policyId ?? args.policy_id;
      if (typeof policyId !== "string" || !policyId) throw new Error("Missing policyId parameter");
      const certificates = await ctx.runQuery(internal.certificates.listByPolicyInternal, {
        orgId,
        policyId: policyId as Id<"policies">,
      });
      return { content: [{ type: "text", text: JSON.stringify(certificates.map(serializeCertificate), null, 2) }] };
    }
    case "generate_policy_certificate": {
      requireMcpWriteScope(identity);
      const policyId = args.policyId ?? args.policy_id;
      if (typeof policyId !== "string" || !policyId) throw new Error("Missing policyId parameter");
      const certificate = normalizeCertificateRequest(args);
      if (!certificate.holderName) throw new Error("Missing certificate holder");
      const result = await ctx.runAction(internal.certificates.generateForOrg, {
        orgId,
        policyId: policyId as Id<"policies">,
        ...certificate,
        source: "mcp",
        createdByUserId: userId,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "list_quotes": {
      const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, { orgId });
      const filtered = quotes.filter(
(q: any) => {
        if (args.carrier && q.carrier !== args.carrier) return false;
        if (args.year && q.policyYear !== parseInt(args.year as string)) return false;
        return true;
      });
      return { content: [{ type: "text", text: JSON.stringify(filtered.map(
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
      const found = quotes.find(
(q: any) => q._id === args.id);
      if (!found) throw new Error("Not found");

      return { content: [{ type: "text", text: JSON.stringify(found, null, 2) }] };
    }
    case "list_threads": {
      const threads = await ctx.runQuery(internal.threads.listByOrg, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(threads.map(
(t: any) => ({
        _id: t._id, title: t.title, lastMessageAt: t.lastMessageAt, archivedAt: t.archivedAt, _creationTime: t._creationTime,
      })), null, 2) }] };
    }
    case "get_thread_messages": {
      if (!args.threadId) throw new Error("Missing threadId parameter");
      const thread = await ctx.runQuery(internal.threads.getInternal, { id: args.threadId as Id<"threads"> });
      if (!thread || (thread as Record<string, unknown>).orgId !== identity.orgId) throw new Error("Not found");
      const messages = await ctx.runQuery(internal.threads.messagesInternal, { threadId: args.threadId as Id<"threads"> });
      return { content: [{ type: "text", text: JSON.stringify(messages.map(
(m: any) => ({
        _id: m._id, role: m.role, channel: m.channel, content: m.content, userName: m.userName, fromEmail: m.fromEmail, _creationTime: m._creationTime,
      })), null, 2) }] };
    }
    case "get_org_info": {
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) throw new Error("Not found");
      return { content: [{ type: "text", text: JSON.stringify({
        _id: org._id, name: org.name, website: org.website, industry: org.industry,
        industryVertical: org.industryVertical, context: org.context,
      }, null, 2) }] };
    }
    case "ask_glass": {
      if (!args.message) throw new Error("Missing message");
      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId, userId, message: args.message as string,
        threadId: (args.threadId as string) ?? undefined,
      });
      return { content: [{ type: "text", text: `**Thread:** ${result.threadId}\n\n${result.response}` }] };
    }
    case "list_email_drafts": {
      const drafts = await ctx.runQuery(internal.pendingEmails.listDraftsInternal, {
        orgId,
        threadId: typeof args.threadId === "string" && args.threadId
          ? args.threadId as Id<"threads">
          : undefined,
      });
      const showAll = args.showAll === true;
      const summary = drafts.length > 0
        ? buildEmailDraftTextSummary(drafts, {
            sampleSize: showAll ? drafts.length : 3,
            includeIds: true,
            commands: "mcp",
          })
        : "No email drafts found.";
      return { content: [{ type: "text", text: summary }] };
    }
    case "draft_email":
    case "update_email_draft": {
      requireMcpWriteScope(identity);
      if (name === "update_email_draft" && !args.draftId) throw new Error("Missing draftId parameter");
      if (!args.to || !args.subject || !args.body) throw new Error("Missing to, subject, or body parameter");
      const draft = await ctx.runAction(internal.actions.emailDrafts.upsertForMcp, {
        orgId,
        userId,
        draftId: typeof args.draftId === "string" ? args.draftId as Id<"pendingEmails"> : undefined,
        threadId: typeof args.threadId === "string" ? args.threadId as Id<"threads"> : undefined,
        to: args.to as string,
        subject: args.subject as string,
        body: args.body as string,
        cc: Array.isArray(args.cc) ? args.cc.filter((value): value is string => typeof value === "string") : undefined,
        bcc: Array.isArray(args.bcc) ? args.bcc.filter((value): value is string => typeof value === "string") : undefined,
        originalPolicyIds: Array.isArray(args.originalPolicyIds)
          ? args.originalPolicyIds.filter((value): value is Id<"policies"> => typeof value === "string") as Id<"policies">[]
          : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(draft, null, 2) }] };
    }
    case "send_email_draft": {
      requireMcpWriteScope(identity);
      if (typeof args.draftId !== "string" || !args.draftId) throw new Error("Missing draftId parameter");
      const draft = await ctx.runAction(internal.actions.emailDrafts.sendForMcp, {
        orgId,
        draftId: args.draftId as Id<"pendingEmails">,
      });
      return { content: [{ type: "text", text: JSON.stringify(draft, null, 2) }] };
    }
    case "send_email_drafts": {
      requireMcpWriteScope(identity);
      const draftIds = Array.isArray(args.draftIds)
        ? args.draftIds.filter((value): value is Id<"pendingEmails"> => typeof value === "string") as Id<"pendingEmails">[]
        : [];
      if (draftIds.length === 0) throw new Error("Missing draftIds parameter");
      const result = await ctx.runAction(internal.actions.emailDrafts.sendManyForMcp, {
        orgId,
        draftIds,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "cancel_email_draft": {
      requireMcpWriteScope(identity);
      if (typeof args.draftId !== "string" || !args.draftId) throw new Error("Missing draftId parameter");
      const draft = await ctx.runAction(internal.actions.emailDrafts.cancelForMcp, {
        orgId,
        draftId: args.draftId as Id<"pendingEmails">,
      });
      return { content: [{ type: "text", text: JSON.stringify(draft, null, 2) }] };
    }
    // ── Broker tools ──
    case "list_clients": {
      const clients = await ctx.runQuery((internal as any).clients.listForBrokerInternal, {
        brokerOrgId: orgId,
        userId,
      });
      return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
    }
    case "get_client": {
      const clientOrgId = args.client_org_id as Id<"organizations">;
      const detail = await ctx.runQuery((internal as any).clients.getDetailInternal, {
        brokerOrgId: orgId,
        clientOrgId,
        userId,
      });
      if (!detail) throw new Error("Not found");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId });
      return { content: [{ type: "text", text: JSON.stringify({ org: detail, policy_count: policies.length }, null, 2) }] };
    }
    case "list_broker_activity": {
      const activity = await ctx.runQuery((internal as any).brokerActivity.listPortfolio, {
        orgId, limit: 50,
      }).catch(() => []);
      return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
    }
    case "list_connected_vendors": {
      const vendors = await ctx.runQuery((internal as any).connectedOrgs.listActiveVendorsInternal, { clientOrgId: orgId });
      return { content: [{ type: "text", text: JSON.stringify(vendors, null, 2) }] };
    }
    case "get_connected_vendor": {
      const vendorOrgId = args.vendor_org_id as Id<"organizations">;
      if (!vendorOrgId) throw new Error("Missing vendor_org_id");
      const allowed = await ctx.runQuery((internal as any).connectedOrgs.hasActiveConnectionInternal, {
        clientOrgId: orgId,
        vendorOrgId,
      });
      if (!allowed) throw new Error("Connected vendor not found");
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: vendorOrgId });
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: vendorOrgId });
      return { content: [{ type: "text", text: JSON.stringify({ org, policy_count: policies.length }, null, 2) }] };
    }
    case "list_connected_vendor_policies": {
      const vendorOrgId = args.vendor_org_id as Id<"organizations">;
      if (!vendorOrgId) throw new Error("Missing vendor_org_id");
      const allowed = await ctx.runQuery((internal as any).connectedOrgs.hasActiveConnectionInternal, {
        clientOrgId: orgId,
        vendorOrgId,
      });
      if (!allowed) throw new Error("Connected vendor not found");
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: vendorOrgId });
      return { content: [{ type: "text", text: JSON.stringify(policies.map((p: any) => ({
        _id: p._id, carrier: p.carrier, policyNumber: p.policyNumber, policyTypes: p.policyTypes,
        effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium, insuredName: p.insuredName,
      })), null, 2) }] };
    }
    case "list_my_policies": {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(policies.map((p: any) => ({
        _id: p._id, carrier: p.carrier, policyNumber: p.policyNumber,
        policyTypes: p.policyTypes, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium,
      })), null, 2) }] };
    }
    case "list_insurance_requirements": {
      const requirements = await ctx.runQuery((internal as any).compliance.listRequirementsInternal, { orgId });
      return { content: [{ type: "text", text: JSON.stringify(requirements, null, 2) }] };
    }
    case "create_insurance_requirement": {
      requireMcpWriteScope(identity);
      if (!args.title || !args.category || !args.requirement_text) throw new Error("Missing title, category, or requirement_text");
      const requirementId = await ctx.runMutation((internal as any).compliance.upsertRequirementInternal, {
        orgId,
        userId,
        title: String(args.title),
        category: String(args.category),
        requirementText: String(args.requirement_text),
        sourceDocumentName: args.source_document_name ? String(args.source_document_name) : undefined,
        sourceType: args.source_document_name || args.source_excerpt ? "other" : "manual",
        sourceExcerpt: args.source_excerpt ? String(args.source_excerpt) : undefined,
        appliesTo: "vendors",
      });
      return { content: [{ type: "text", text: JSON.stringify({ requirementId }, null, 2) }] };
    }
    case "list_vendor_compliance": {
      const compliance = await ctx.runQuery((internal as any).compliance.listVendorComplianceInternal, { clientOrgId: orgId });
      return { content: [{ type: "text", text: JSON.stringify(compliance, null, 2) }] };
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
          const siteUrl = getClientPortalUrl();
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
              ],
            },
            instructions: "Glass is an insurance intelligence platform. Use Glass tools to look up policies, quotes, threads, and org info. Use ask_glass for complex insurance questions.",
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

// Streamable HTTP clients may probe GET /mcp for an optional server-to-client SSE stream.
// Glass is stateless and responds to MCP requests directly over POST.
http.route({
  path: "/mcp",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "POST, DELETE",
      },
    });
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

// GET /mcp/email/drafts/list
http.route({
  path: "/mcp/email/drafts/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const url = new URL(request.url);
      const threadId = url.searchParams.get("threadId");
      const showAll = url.searchParams.get("showAll") === "true";
      const drafts = await ctx.runQuery(internal.pendingEmails.listDraftsInternal, {
        orgId: identity.orgId as Id<"organizations">,
        threadId: threadId ? threadId as Id<"threads"> : undefined,
      });
      return jsonResponse({
        summary: drafts.length > 0
          ? buildEmailDraftTextSummary(drafts, {
              sampleSize: showAll ? drafts.length : 3,
              includeIds: true,
              commands: "mcp",
            })
          : "No email drafts found.",
        drafts,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/upsert
http.route({
  path: "/mcp/email/drafts/upsert",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.to || !body.subject || !body.body) {
        return jsonResponse({ error: "Missing to, subject, or body" }, 400);
      }
      const draft = await ctx.runAction(internal.actions.emailDrafts.upsertForMcp, {
        orgId: identity.orgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
        draftId: body.draftId ? body.draftId as Id<"pendingEmails"> : undefined,
        threadId: body.threadId ? body.threadId as Id<"threads"> : undefined,
        to: body.to,
        subject: body.subject,
        body: body.body,
        cc: Array.isArray(body.cc) ? body.cc : undefined,
        bcc: Array.isArray(body.bcc) ? body.bcc : undefined,
        originalPolicyIds: Array.isArray(body.originalPolicyIds) ? body.originalPolicyIds : undefined,
      });
      return jsonResponse(draft);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/send
http.route({
  path: "/mcp/email/drafts/send",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.draftId) return jsonResponse({ error: "Missing draftId" }, 400);
      const draft = await ctx.runAction(internal.actions.emailDrafts.sendForMcp, {
        orgId: identity.orgId as Id<"organizations">,
        draftId: body.draftId as Id<"pendingEmails">,
      });
      return jsonResponse(draft);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/send-batch
http.route({
  path: "/mcp/email/drafts/send-batch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      const draftIds = Array.isArray(body.draftIds)
        ? body.draftIds.filter((value: unknown): value is Id<"pendingEmails"> => typeof value === "string")
        : [];
      if (draftIds.length === 0) return jsonResponse({ error: "Missing draftIds" }, 400);
      const result = await ctx.runAction(internal.actions.emailDrafts.sendManyForMcp, {
        orgId: identity.orgId as Id<"organizations">,
        draftIds,
      });
      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/cancel
http.route({
  path: "/mcp/email/drafts/cancel",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.draftId) return jsonResponse({ error: "Missing draftId" }, 400);
      const draft = await ctx.runAction(internal.actions.emailDrafts.cancelForMcp, {
        orgId: identity.orgId as Id<"organizations">,
        draftId: body.draftId as Id<"pendingEmails">,
      });
      return jsonResponse(draft);
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
      const result = await ctx.runQuery((internal as any).clients.listForBrokerInternal, {
        brokerOrgId: identity.orgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
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
      const detail = await ctx.runQuery((internal as any).clients.getDetailInternal, {
        brokerOrgId: identity.orgId as Id<"organizations">,
        clientOrgId: clientOrgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
      });
      if (!detail) return jsonResponse({ error: "Not found" }, 404);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId as Id<"organizations"> });
      return jsonResponse({ org: detail, policy_count: policies.length });
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

// ── REST API v1 helpers ──

function extractBearerToken(request: Request): string {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7);
}

async function requireApiAuth(
  ctx: {
    runQuery: (...args: any[]) => Promise<any>;
    runMutation: (...args: any[]) => Promise<any>;
  },
  request: Request,
): Promise<{ userId: Id<"users">; orgId: Id<"organizations">; scopes: ("read" | "write")[]; tokenId: Id<"oauthTokens">; requestId: string }> {
  const requestId = crypto.randomUUID();
  const rawToken = extractBearerToken(request);
  if (!rawToken) {
    throw jsonResponse({ error: { code: "unauthorized", message: "Missing bearer token", request_id: requestId } }, 401);
  }
  const orgIdHeader = request.headers.get("x-org-id") ?? request.headers.get("X-Org-Id") ?? "";

  async function assertMembership(userId: Id<"users">, orgId: Id<"organizations">) {
    const hasMembership = await ctx.runQuery((internal as any).orgs.hasMembershipInternal, {
      orgId,
      userId,
    });
    if (!hasMembership) {
      throw jsonResponse(
        {
          error: {
            code: "forbidden",
            message: "User does not have access to the requested org",
            request_id: requestId,
          },
        },
        403,
      );
    }
  }

  // API key path
  if (rawToken.startsWith("glass_")) {
    const keyHash = await sha256Hex(rawToken);
    const result = await ctx.runQuery(internal.apiKeys.validateKey, { keyHash });
    if (!result) {
      throw jsonResponse({ error: { code: "unauthorized", message: "Invalid or revoked API key", request_id: requestId } }, 401);
    }
    await ctx.runMutation(internal.apiKeys.touchLastUsed, { id: result.keyId });
    // Find a token record for audit log — skip rate limit for API keys, use a sentinel
    const resolvedOrgId = (orgIdHeader || result.orgId) as Id<"organizations">;
    await assertMembership(result.userId as Id<"users">, resolvedOrgId);
    return {
      userId: result.userId as Id<"users">,
      orgId: resolvedOrgId,
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
  await assertMembership(tokenData.userId as Id<"users">, orgId);

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
      const rows = await ctx.runQuery((internal as any).clients.listForBrokerInternal, {
        brokerOrgId: identity.orgId,
        userId: identity.userId,
      });
      const data = (rows ?? []).map((row: any) =>
        row.onboardingStatus === "invited"
          ? {
              invitation_id: row.invitationId,
              name: row.name,
              onboarding_status: "invited",
              created_at: row.createdAt,
            }
          : {
              id: row.clientOrgId,
              name: row.name,
              onboarding_status: row.onboardingStatus,
              created_at: row.createdAt,
              last_activity_at: row.lastActivityAt,
            },
      );
      return jsonResponse({ data, next_cursor: null });
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
      const detail = await ctx.runQuery((internal as any).clients.getDetailInternal, {
        brokerOrgId: identity.orgId,
        clientOrgId,
        userId: identity.userId,
      });
      if (!detail) {
        return jsonResponse({ error: { code: "not_found", message: "Client not found" } }, 404);
      }
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: clientOrgId });
      return jsonResponse({
        id: detail.clientOrgId,
        name: detail.name,
        legal_name: detail.legalName ?? null,
        website: detail.website ?? null,
        industry: detail.industry ?? null,
        context: detail.context ?? null,
        policy_count: policies.length,
      });
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

// ── GET /api/v1/policies ──
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


// ── GET /api/v1/policies/:id/file ──
http.route({
  path: "/api/v1/policies/:id/file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const parts = new URL(request.url).pathname.split("/");
      const policyId = parts[parts.length - 2] as Id<"policies">;
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: identity.orgId });
      const policy = policies.find((p: any) => p._id === policyId);
      if (!policy) return jsonResponse({ error: { code: "not_found", message: "Policy not found" } }, 404);
      if (!policy.fileId) return jsonResponse({ error: { code: "not_found", message: "Original policy PDF is not available" } }, 404);
      const url = await ctx.storage.getUrl(policy.fileId as Id<"_storage">);
      if (!url) return jsonResponse({ error: { code: "not_found", message: "Original policy PDF is not available" } }, 404);
      return jsonResponse({
        data: {
          id: policy._id,
          file_id: policy.fileId,
          file_name: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
          content_type: "application/pdf",
          url,
        },
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/policies/:id/certificates ──
http.route({
  path: "/api/v1/policies/:id/certificates",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const parts = new URL(request.url).pathname.split("/");
      const policyId = parts[parts.length - 2] as Id<"policies">;
      const certificates = await ctx.runQuery(internal.certificates.listByPolicyInternal, {
        orgId: identity.orgId,
        policyId,
      });
      return jsonResponse({
        data: certificates.map(serializeCertificate),
        next_cursor: null,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── POST /api/v1/policies/:id/certificates ──
http.route({
  path: "/api/v1/policies/:id/certificates",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse({ error: { code: "insufficient_scope", message: "Write scope required", request_id: identity.requestId } }, 403);
      }

      const parts = new URL(request.url).pathname.split("/");
      const policyId = parts[parts.length - 2] as Id<"policies">;
      const body = await request.json() as Record<string, unknown>;
      const certificate = normalizeCertificateRequest(body);
      if (!certificate.holderName) {
        return jsonResponse({ error: { code: "bad_request", message: "Missing certificate_holder_name" } }, 400);
      }

      const result = await ctx.runAction(internal.certificates.generateForOrg, {
        orgId: identity.orgId,
        policyId,
        ...certificate,
        source: "api",
        createdByUserId: identity.userId,
      });
      return jsonResponse({ data: result }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/vendors ──
http.route({
  path: "/api/v1/vendors",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const vendors = await ctx.runQuery((internal as any).connectedOrgs.listActiveVendorsInternal, {
        clientOrgId: identity.orgId,
      });
      return jsonResponse({ data: vendors, next_cursor: null });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/vendors/:id ──
http.route({
  path: "/api/v1/vendors/:id",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const vendorOrgId = new URL(request.url).pathname.split("/").pop() as Id<"organizations">;
      const allowed = await ctx.runQuery((internal as any).connectedOrgs.hasActiveConnectionInternal, {
        clientOrgId: identity.orgId,
        vendorOrgId,
      });
      if (!allowed) return jsonResponse({ error: { code: "not_found", message: "Vendor not found" } }, 404);
      const [org, policies] = await Promise.all([
        ctx.runQuery(internal.orgs.getInternal, { id: vendorOrgId }),
        ctx.runQuery(internal.policies.listAllInternal, { orgId: vendorOrgId }),
      ]);
      return jsonResponse({ org, policy_count: policies.length });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/vendors/:id/policies ──
http.route({
  path: "/api/v1/vendors/:id/policies",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const parts = new URL(request.url).pathname.split("/");
      const vendorOrgId = parts[parts.length - 2] as Id<"organizations">;
      const allowed = await ctx.runQuery((internal as any).connectedOrgs.hasActiveConnectionInternal, {
        clientOrgId: identity.orgId,
        vendorOrgId,
      });
      if (!allowed) return jsonResponse({ error: { code: "not_found", message: "Vendor not found" } }, 404);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId: vendorOrgId });
      return jsonResponse({
        data: policies.map((p: any) => ({
          id: p._id, carrier: p.carrier, policy_number: p.policyNumber,
          policy_types: p.policyTypes, effective_date: p.effectiveDate,
          expiration_date: p.expirationDate, premium: p.premium, created_at: p._creationTime,
        })),
        next_cursor: null,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});


// ── GET /api/v1/compliance/requirements ──
http.route({
  path: "/api/v1/compliance/requirements",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const requirements = await ctx.runQuery((internal as any).compliance.listRequirementsInternal, { orgId: identity.orgId });
      return jsonResponse({ data: requirements, next_cursor: null });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── POST /api/v1/compliance/requirements ──
http.route({
  path: "/api/v1/compliance/requirements",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse({ error: { code: "insufficient_scope", message: "Write scope required", request_id: identity.requestId } }, 403);
      }
      const body = await request.json();
      const requirementId = await ctx.runMutation((internal as any).compliance.upsertRequirementInternal, {
        orgId: identity.orgId,
        userId: identity.userId,
        title: String(body.title ?? ""),
        category: String(body.category ?? "other"),
        requirementText: String(body.requirement_text ?? body.requirementText ?? ""),
        sourceDocumentName: body.source_document_name
          ? String(body.source_document_name)
          : body.sourceDocumentName
            ? String(body.sourceDocumentName)
            : undefined,
        sourceType:
          body.source_document_name ||
          body.sourceDocumentName ||
          body.source_excerpt ||
          body.sourceExcerpt
            ? "other"
            : "manual",
        sourceExcerpt: body.source_excerpt
          ? String(body.source_excerpt)
          : body.sourceExcerpt
            ? String(body.sourceExcerpt)
            : undefined,
        appliesTo: "vendors",
      });
      return jsonResponse({ id: requirementId }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: { code: "internal_error", message: String(e) } }, 500);
    }
  }),
});

// ── GET /api/v1/compliance/vendors ──
http.route({
  path: "/api/v1/compliance/vendors",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const rows = await ctx.runQuery((internal as any).compliance.listVendorComplianceInternal, { clientOrgId: identity.orgId });
      return jsonResponse({ data: rows, next_cursor: null });
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
        "/api/v1/policies": { get: { tags: ["Policies"], summary: "List policies", responses: { "200": { description: "Policies" } } } },
        "/api/v1/policies/{id}": { get: { tags: ["Policies"], summary: "Get policy", responses: { "200": { description: "Policy" } } } },
        "/api/v1/policies/{id}/certificates": {
          get: { tags: ["Certificates"], summary: "List generated Certificates of Insurance for a policy", responses: { "200": { description: "Certificates" } } },
          post: { tags: ["Certificates"], summary: "Generate a Certificate of Insurance for a policy (write)", responses: { "201": { description: "Certificate generated" } } },
        },
        "/api/v1/vendors": { get: { tags: ["Vendors"], summary: "List connected vendors", responses: { "200": { description: "Connected vendors" } } } },
        "/api/v1/vendors/{id}": { get: { tags: ["Vendors"], summary: "Get connected vendor detail", responses: { "200": { description: "Connected vendor" } } } },
        "/api/v1/vendors/{id}/policies": { get: { tags: ["Vendors"], summary: "List connected vendor policies", responses: { "200": { description: "Vendor policies" } } } },
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
          uri: `${url.origin}/mcp`,
          instructions: "Glass is an insurance intelligence platform. Use Glass tools to look up policies, quotes, threads, and broker-client workflows.",
        },
      },
    });
  }),
});

export default http;
