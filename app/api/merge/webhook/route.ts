// app/api/merge/webhook/route.ts
//
// Forwards Merge webhook events to the Convex HTTP handler.
// In production, configure Merge to POST directly to:
//   https://<convex-deployment>.convex.site/merge/webhook
// This Next.js route is a convenience alias (e.g. when using a custom domain).

import { NextRequest, NextResponse } from "next/server";

const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(
  ".cloud",
  ".site",
) ?? "";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!CONVEX_SITE_URL) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL not configured" },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const sig = request.headers.get("x-merge-webhook-signature") ?? "";

  const res = await fetch(`${CONVEX_SITE_URL}/merge/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-merge-webhook-signature": sig,
    },
    body: rawBody,
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text }, { status: res.status });
  }

  return new NextResponse("OK", { status: 200 });
}
