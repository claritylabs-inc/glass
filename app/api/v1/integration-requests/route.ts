// app/api/v1/integration-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * GET  /api/v1/integration-requests  — list requests (broker or client depending on X-Org-Id context)
 * POST /api/v1/integration-requests  — broker creates a request (write scope required)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const orgId = request.headers.get("x-org-id");
  const token = request.headers.get("authorization")?.slice(7);
  if (!orgId || !token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing Authorization or X-Org-Id" } },
      { status: 401 },
    );
  }

  try {
    convex.setAuth(token);
    // Try client list first, fall back to broker list
    const data = await convex.query(
      (api as any).integrationRequests.listForClient,
      { clientOrgId: orgId },
    );
    return NextResponse.json({ data, next_cursor: null });
  } catch {
    try {
      convex.setAuth(token);
      const data = await convex.query(
        (api as any).integrationRequests.listForBroker,
        { brokerOrgId: orgId },
      );
      return NextResponse.json({ data, next_cursor: null });
    } catch (e2) {
      const message = e2 instanceof Error ? e2.message : "Internal error";
      return NextResponse.json(
        { error: { code: "internal_error", message } },
        { status: 500 },
      );
    }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.headers.get("authorization")?.slice(7);
  if (!token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing Authorization" } },
      { status: 401 },
    );
  }

  let body: { clientOrgId: string; category: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (!body.clientOrgId || !body.category) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "clientOrgId and category are required" } },
      { status: 400 },
    );
  }

  try {
    convex.setAuth(token);
    const requestId = await convex.mutation(
      (api as any).integrationRequests.create,
      {
        clientOrgId: body.clientOrgId,
        category: body.category,
        message: body.message,
      },
    );
    return NextResponse.json({ data: { id: requestId } }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    if (message.includes("Only broker")) {
      return NextResponse.json(
        { error: { code: "forbidden", message } },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: { code: "internal_error", message } },
      { status: 500 },
    );
  }
}
