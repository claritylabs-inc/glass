import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function sanitizeReturnTo(returnTo?: string) {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/settings?section=email-connections";
  }
  return returnTo;
}

function errorRedirect(message: string, returnTo = "/settings?section=email-connections") {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const destination = new URL(sanitizeReturnTo(returnTo), appUrl);
  destination.searchParams.set("google", "error");
  destination.searchParams.set("message", message);
  return NextResponse.redirect(destination.toString());
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

  const cookieState = req.cookies.get("google_oauth_state")?.value;
  if (!cookieState || cookieState !== stateParam) {
    return errorRedirect("Invalid or expired OAuth state. Please try again");
  }

  let oauthState:
    | {
        userId: Id<"users">;
        orgId: Id<"organizations">;
        sinceDate?: string;
        returnTo?: string;
      }
    | null
    | undefined;

  try {
    oauthState = await fetchMutation(api.connections.consumeOAuthStateFromServer, {
      serverSecret,
      state: stateParam,
    });
  } catch (err) {
    console.error("Failed to consume OAuth state:", err);
    return errorRedirect("Failed to validate OAuth state");
  }

  if (!oauthState) {
    return errorRedirect("OAuth state expired or was already used");
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
    return errorRedirect(
      "Failed to exchange authorization code",
      oauthState.returnTo,
    );
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
      return errorRedirect("Could not retrieve email from Google", oauthState.returnTo);
    }
  }

  if (!email) {
    return errorRedirect("Could not determine email address");
  }

  // Save the Google connection via Convex public mutation (guarded by server secret)
  try {
    await fetchMutation(api.connections.connectGoogle, {
      serverSecret,
      userId: oauthState.userId,
      orgId: oauthState.orgId,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      sinceDate: oauthState.sinceDate ?? undefined,
    });
  } catch (err) {
    console.error("Failed to save Google connection:", err);
    return errorRedirect("Failed to save connection", oauthState.returnTo);
  }

  // Clear the OAuth state cookie and redirect to connections page
  const redirectParams = new URLSearchParams({ google: "connected" });
  if (oauthState.sinceDate) redirectParams.set("sinceDate", oauthState.sinceDate);
  const returnTo = sanitizeReturnTo(oauthState.returnTo);
  const destination = new URL(returnTo, appUrl);
  redirectParams.forEach((value, key) => {
    destination.searchParams.set(key, value);
  });
  const response = NextResponse.redirect(
    destination.toString(),
  );
  response.cookies.set("google_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 0,
  });

  return response;
}
