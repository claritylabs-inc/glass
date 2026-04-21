// app/api/v1/integrations/[connectionId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<NextResponse> {
  const { connectionId } = await params;
  const token = request.headers.get("authorization")?.slice(7);
  if (!token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing Authorization" } },
      { status: 401 },
    );
  }

  try {
    convex.setAuth(token);
    const conn = await convex.query(
      (api as any).integrationConnections.getInternal,
      { connectionId },
    );
    if (!conn) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Connection not found" } },
        { status: 404 },
      );
    }
    // Strip encrypted token before returning
    const { mergeAccountTokenEncrypted: _, ...safe } = conn;
    return NextResponse.json({ data: safe });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json(
      { error: { code: "internal_error", message } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<NextResponse> {
  const { connectionId } = await params;
  const token = request.headers.get("authorization")?.slice(7);
  if (!token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing Authorization" } },
      { status: 401 },
    );
  }

  try {
    convex.setAuth(token);
    await convex.action(
      (api as any).actions.integrationConnectionActions.disconnect,
      { connectionId },
    );
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    if (message.includes("Unauthorized") || message.includes("Only org members")) {
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
