import { describe, expect, test } from "vitest";
import {
  isActorBoundExplicitEmailSendSource,
  isExplicitEmailSendRequest,
  sourceExplicitlyNamesEmailAddress,
} from "./emailSendIntent";

describe("explicit email send intent", () => {
  test.each([
    "Thanks can you draft and send an email with that to terry@claritylabs.inc",
    "Please send this certificate to the holder",
    "Go ahead and email it",
    "Draft an email and then send it",
    "You can send it now",
  ])("accepts an affirmative delivery instruction: %s", (messageText) => {
    expect(isExplicitEmailSendRequest(messageText)).toBe(true);
  });

  test.each([
    "Can you draft an email to Terry?",
    "Draft only, please",
    "Draft it but don't send it",
    "Should I send this to Terry?",
    "What happens if I send this to Terry?",
    "Can you draft this without sending it?",
    "I don't want you to send this yet",
    "Wait before sending it",
    'The previous note said "Please send this certificate to Terry."',
    "> Please send this certificate to Terry.\nWhat should I do next?",
  ])("rejects a draft-only, negated, or advisory request: %s", (messageText) => {
    expect(isExplicitEmailSendRequest(messageText)).toBe(false);
  });

  test("accepts an explicit direction outside quoted text", () => {
    expect(
      isExplicitEmailSendRequest(
        'The previous note said "Please send this certificate." Go ahead and send it now.',
      ),
    ).toBe(true);
  });

  test("binds authorization to the current user, organization, and thread", () => {
    const message = {
      orgId: "org-1",
      threadId: "thread-1",
      role: "user",
      content: "Please send this to terry@claritylabs.inc",
      userId: "user-1",
    };

    expect(
      isActorBoundExplicitEmailSendSource({
        message,
        orgId: "org-1",
        threadId: "thread-1",
        actorUserId: "user-1",
      }),
    ).toBe(true);
    expect(
      isActorBoundExplicitEmailSendSource({
        message,
        orgId: "org-1",
        threadId: "thread-2",
        actorUserId: "user-1",
      }),
    ).toBe(false);
    expect(
      isActorBoundExplicitEmailSendSource({
        message,
        orgId: "org-1",
        threadId: "thread-1",
        actorUserId: "user-2",
      }),
    ).toBe(false);
  });

  test("recognizes an explicitly supplied recipient exactly", () => {
    expect(
      sourceExplicitlyNamesEmailAddress(
        "Send it to Terry@ClarityLabs.inc, please.",
        "terry@claritylabs.inc",
      ),
    ).toBe(true);
    expect(
      sourceExplicitlyNamesEmailAddress(
        "Send it to Terry, please.",
        "terry@claritylabs.inc",
      ),
    ).toBe(false);
    expect(
      sourceExplicitlyNamesEmailAddress(
        "Send it to notterry@claritylabs.inc, please.",
        "terry@claritylabs.inc",
      ),
    ).toBe(false);
  });
});
