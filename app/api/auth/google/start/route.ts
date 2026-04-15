import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "Google OAuth not configured" },
      { status: 503 },
    );
  }

  // orgId is passed as a query param from the frontend
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json(
      { error: "Missing orgId parameter" },
      { status: 400 },
    );
  }

  // Generate a random nonce for CSRF protection
  const nonce = crypto.randomUUID();

  // Optional: sinceDate for initial scan history
  const sinceDate = req.nextUrl.searchParams.get("sinceDate");

  // Encode orgId, nonce, and sinceDate into the state parameter
  const state = Buffer.from(JSON.stringify({ nonce, orgId, sinceDate })).toString(
    "base64url",
  );

  // Build the Google OAuth authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: "https://mail.google.com/ email",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Set the nonce in an httpOnly cookie so we can verify it on callback
  const response = NextResponse.redirect(googleAuthUrl);
  response.cookies.set("google_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 600, // 10 minutes
  });

  return response;
}
