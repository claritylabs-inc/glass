import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { CONSUMER_DOMAINS } from "@/lib/auth/consumer-domains";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/signup?error=invalid");
  const domain = email.split("@")[1];
  if (CONSUMER_DOMAINS.has(domain)) redirect("/signup?error=consumer-domain");

  const url = await getSignUpUrl({ loginHint: email });
  redirect(url);
}
