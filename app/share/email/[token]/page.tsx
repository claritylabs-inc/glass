import type { Metadata } from "next";
import { EmailDraftReview } from "./review";
import { loadEmailDraftReview } from "./view";

type PageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const view = await loadEmailDraftReview(token);
  if (!view || view.state === "expired" || view.state === "stale") {
    return {
      title: "Email draft review",
      description: "Review an email draft prepared by Spot.",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `Review email: ${view.subject}`,
    description: `Review an email draft to ${view.recipientEmail} before sending.`,
    robots: { index: false, follow: false },
  };
}

export default async function EmailDraftReviewPage({ params }: PageProps) {
  const { token } = await params;
  const view = await loadEmailDraftReview(token);
  return <EmailDraftReview token={token} initialView={view} />;
}
