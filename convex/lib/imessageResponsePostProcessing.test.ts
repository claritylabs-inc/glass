import { describe, expect, test } from "vitest";
import { postProcessImessageResponseText } from "./imessageResponsePostProcessing";

describe("postProcessImessageResponseText", () => {
  test("repairs claimed COI completion when no COI side effect happened", () => {
    expect(
      postProcessImessageResponseText({
        messageText: "Generate a COI for Acme",
        recentConversationContext: "",
        responseText: "Done, I generated the COI.",
        usedTools: [],
        responseFileAttachments: [],
        shouldStripGenericCta: true,
      }),
    ).toBe(
      "I haven't generated that COI yet. I need to resolve the policy and create the certificate first.",
    );
  });

  test("keeps COI completion when a generated attachment exists", () => {
    expect(
      postProcessImessageResponseText({
        messageText: "Generate a COI for Acme",
        recentConversationContext: "",
        responseText: "Done, I generated the COI.",
        usedTools: [],
        responseFileAttachments: [
          { filename: "certificate-of-insurance-acme.pdf" },
        ],
        shouldStripGenericCta: true,
      }),
    ).toBe("Done, I generated the COI.");
  });

  test("refuses internal policy record ID requests", () => {
    expect(
      postProcessImessageResponseText({
        messageText: "Send the policy",
        recentConversationContext: "",
        responseText: "The internal policy id is abc123.",
        usedTools: [],
        responseFileAttachments: [],
        shouldStripGenericCta: true,
      }),
    ).toBe(
      "I can use the policy number, named insured, carrier, or a policy list result instead.",
    );
  });

  test("strips generic GPT-style closing CTA when enabled", () => {
    expect(
      postProcessImessageResponseText({
        messageText: "What are my limits?",
        recentConversationContext: "",
        responseText: "Your aggregate limit is $2,000,000. If you want, I can zoom in on that.",
        usedTools: [],
        responseFileAttachments: [],
        shouldStripGenericCta: true,
      }),
    ).toBe("Your aggregate limit is $2,000,000.");
  });
});
