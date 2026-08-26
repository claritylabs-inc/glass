import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

export type EmailDraftReviewView =
  | null
  | { state: "expired" }
  | { state: "stale"; orgName: string }
  | {
      state: "draft" | "sending" | "pending" | "sent" | "cancelled";
      orgName: string;
      recipientEmail: string;
      ccAddresses: string[];
      bccAddresses: string[];
      subject: string;
      renderedText: string;
      renderedHtml?: string;
      attachments: Array<{
        filename: string;
        contentType: string;
        size: number;
      }>;
      canSend: boolean;
    };

const getEmailDraftReview = makeFunctionReference<
  "query",
  { token: string },
  EmailDraftReviewView
>("emailDraftReviewLinks:getByToken");

export async function loadEmailDraftReview(
  token: string,
): Promise<EmailDraftReviewView> {
  return await fetchQuery(getEmailDraftReview, { token });
}
