import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function errorRedirect(message: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const params = new URLSearchParams({
    google: "error",
    message,
  });
  return NextResponse.redirect(`${appUrl}/connections?${params.toString()}`);
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const serverSecret = process.env.GOOGLE_OAUTH_SERVER_SECRET;

  if (!appUrl || !clientId || !clientSecret || !serverSecret) {
    return errorRedirect("Google OAuth not configured");
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return errorRedirect(errorParam);
  }

  if (!code || !stateParam) {
    return errorRedirect("Missing code or state parameter");
  }

  // Decode state and verify nonce
  let state: { nonce: string; orgId: string };
  try {
    state = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf-8"));
  } catch {
    return errorRedirect("Invalid state parameter");
  }

  const cookieNonce = req.cookies.get("google_oauth_nonce")?.value;
  if (!cookieNonce || cookieNonce !== state.nonce) {
    return errorRedirect("Invalid or expired nonce — please try again");
  }

  // Exchange authorization code for tokens
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  let tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    id_token?: string | null;
  };

  try {
    const { tokens: t } = await oauth2Client.getToken(code);
    tokens = t;
  } catch (err) {
    console.error("Google token exchange failed:", err);
    return errorRedirect("Failed to exchange authorization code");
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return errorRedirect("Missing access or refresh token from Google");
  }

  // Get the user's email address from the id_token or userinfo endpoint
  let email: string | undefined;

  if (tokens.id_token) {
    try {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      email = ticket.getPayload()?.email;
    } catch {
      // Fall through to userinfo endpoint
    }
  }

  if (!email) {
    try {
      oauth2Client.setCredentials({ access_token: tokens.access_token });
      const res = await oauth2Client.request<{ email: string }>({
        url: "https://www.googleapis.com/oauth2/v2/userinfo",
      });
      email = res.data.email;
    } catch (err) {
      console.error("Failed to fetch user email:", err);
      return errorRedirect("Could not retrieve email from Google");
    }
  }

  if (!email) {
    return errorRedirect("Could not determine email address");
  }

  // Save the Google connection via Convex public mutation (guarded by server secret)
  try {
    await convex.mutation(api.connections.connectGoogle, {
      serverSecret,
      orgId: state.orgId,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    });
  } catch (err) {
    console.error("Failed to save Google connection:", err);
    return errorRedirect("Failed to save connection");
  }

  // Clear the nonce cookie and redirect to connections page
  const response = NextResponse.redirect(
    `${appUrl}/connections?google=connected`,
  );
  response.cookies.set("google_oauth_nonce", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 0,
  });

  return response;
}
