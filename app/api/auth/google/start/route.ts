import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "Google OAuth not configured" },
      { status: 503 },
    );
  }

  const state = req.nextUrl.searchParams.get("state");
  if (!state) {
    return NextResponse.json(
      { error: "Missing OAuth state" },
      { status: 400 },
    );
  }

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

  // Mirror the opaque state in a cookie so we can reject cross-site callbacks.
  const response = NextResponse.redirect(googleAuthUrl);
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 600, // 10 minutes
  });

  return response;
}
