type OtpAuthResponse = {
  error?: string;
  tokens?: {
    token?: string;
  } | null;
};

export async function completeOtpSignIn(email: string, code: string): Promise<void> {
  const response = await fetch("/api/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "auth:signIn",
      args: {
        provider: "resend-otp",
        params: { email, code },
      },
    }),
  });
  const result = (await response.json()) as OtpAuthResponse;

  if (!response.ok) {
    throw new Error(result.error ?? "Could not verify code");
  }
  if (!result.tokens?.token) {
    throw new Error("Could not complete sign-in");
  }
}
