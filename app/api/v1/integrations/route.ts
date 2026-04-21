// app/api/v1/integrations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function getOrgIdFromRequest(request: NextRequest): string | null {
  return request.headers.get("x-org-id");
}

async function resolveToken(request: NextRequest): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * GET /api/v1/integrations
 * List integrations for the org in X-Org-Id.
 * Requires Bearer token and X-Org-Id header.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const orgId = getOrgIdFromRequest(request);
  const token = await resolveToken(request);

  if (!orgId || !token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing Authorization or X-Org-Id" } },
      { status: 401 },
    );
  }

  try {
    convex.setAuth(token);
    const connections = await convex.query(
      (api as any).integrationConnections.listForClient,
      { clientOrgId: orgId },
    );

    return NextResponse.json({
      data: connections.map((c: Record<string, unknown>) => ({
        id: c._id,
        category: c.category,
        providerSlug: c.providerSlug,
        providerDisplayName: c.providerDisplayName,
        status: c.status,
        lastSyncAt: c.lastSyncAt ?? null,
        lastSyncStatus: c.lastSyncStatus ?? null,
        connectedAt: c.connectedAt,
      })),
      next_cursor: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    if (message.includes("Unauthorized")) {
      return NextResponse.json(
        { error: { code: "unauthorized", message } },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: { code: "internal_error", message } },
      { status: 500 },
    );
  }
}
