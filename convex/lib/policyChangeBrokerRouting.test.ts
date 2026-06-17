import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  brokerRecipientQuestion,
  buildBrokerSubmissionFromIdentity,
  reconcileBrokerRecipientSnapshot,
} from "./policyChangeBrokerRouting";
import type { BrokerIdentity } from "./brokerIdentity";

function brokerIdentity(
  overrides: Partial<BrokerIdentity> = {},
): BrokerIdentity {
  return {
    clientOrgId: "client_org" as Id<"organizations">,
    brokerOrgId: "broker_org" as Id<"organizations">,
    brokerCompanyName: "Montgomery Risk",
    contactName: "Tom Wong",
    contactEmail: "tom@montgomeryrisk.com",
    contactPhone: "+14155550123",
    source: "broker_default",
    ...overrides,
  };
}

describe("policy change broker recipient reconciliation", () => {
  test("fills stale open cases from the current broker primary contact", () => {
    const question = brokerRecipientQuestion();
    const result = reconcileBrokerRecipientSnapshot({
      changeCase: {
        status: "needs_info",
        brokerSubmission: {
          routingStatus: "needs_broker_contact",
          source: "none",
          needsRecipient: true,
        },
        missingInfoQuestions: [question],
        pendingQuestions: [question.question],
        validationIssues: [],
      },
      currentBrokerSubmission: buildBrokerSubmissionFromIdentity(
        brokerIdentity(),
      ),
    });

    expect(result.changed).toBe(true);
    expect(result.case.status).toBe("ready_to_submit");
    expect(result.case.brokerSubmission).toMatchObject({
      routingStatus: "recipient_ready",
      source: "broker_default",
      brokerCompanyName: "Montgomery Risk",
      recipientEmail: "tom@montgomeryrisk.com",
      recipientName: "Tom Wong",
      contactPhone: "+14155550123",
      needsRecipient: false,
    });
    expect(result.case.missingInfoQuestions).toEqual([]);
    expect(result.case.pendingQuestions).toEqual([]);
  });

  test("preserves an explicit stored recipient over the broker primary contact", () => {
    const question = brokerRecipientQuestion();
    const result = reconcileBrokerRecipientSnapshot({
      changeCase: {
        status: "needs_info",
        brokerSubmission: {
          recipientEmail: "service-team@broker.test",
          recipientName: "Service Team",
          needsRecipient: true,
          routingStatus: "needs_broker_contact",
        },
        missingInfoQuestions: [question],
        pendingQuestions: [question.question],
        validationIssues: [],
      },
      currentBrokerSubmission: buildBrokerSubmissionFromIdentity(
        brokerIdentity({
          contactName: "Default Broker",
          contactEmail: "default@broker.test",
        }),
      ),
    });

    expect(result.case.brokerSubmission).toMatchObject({
      recipientEmail: "service-team@broker.test",
      recipientName: "Service Team",
      needsRecipient: false,
      routingStatus: "recipient_ready",
    });
    expect(result.case.brokerSubmission).not.toMatchObject({
      recipientEmail: "default@broker.test",
    });
  });

  test("preserves unrelated missing info and blocking validation issues", () => {
    const question = brokerRecipientQuestion();
    const entityQuestion = {
      code: "entity_name_required",
      question: "What legal entity should be added?",
      reason: "The endorsement needs the exact entity name.",
    };
    const validationIssue = {
      code: "quoted_value_missing_source_span",
      severity: "blocking",
      message: "Quoted policy values need linked evidence.",
    };

    const result = reconcileBrokerRecipientSnapshot({
      changeCase: {
        status: "needs_info",
        brokerSubmission: {
          needsRecipient: true,
          routingStatus: "needs_broker_contact",
        },
        missingInfoQuestions: [question, entityQuestion],
        pendingQuestions: [question.question, entityQuestion.question],
        validationIssues: [validationIssue],
      },
      currentBrokerSubmission: buildBrokerSubmissionFromIdentity(
        brokerIdentity(),
      ),
    });

    expect(result.case.status).toBe("needs_info");
    expect(result.case.missingInfoQuestions).toEqual([entityQuestion]);
    expect(result.case.pendingQuestions).toEqual([entityQuestion.question]);
    expect(result.case.validationIssues).toEqual([validationIssue]);
  });

  test("does not status-mutate terminal cases", () => {
    const question = brokerRecipientQuestion();
    const result = reconcileBrokerRecipientSnapshot({
      changeCase: {
        status: "completed",
        brokerSubmission: {
          needsRecipient: true,
          routingStatus: "needs_broker_contact",
        },
        missingInfoQuestions: [question],
        pendingQuestions: [question.question],
        validationIssues: [],
      },
      currentBrokerSubmission: buildBrokerSubmissionFromIdentity(
        brokerIdentity(),
      ),
    });

    expect(result.case.status).toBe("completed");
    expect(result.patch?.status).toBeUndefined();
  });

  test("removes certificate-created broker-recipient questions", () => {
    const question = brokerRecipientQuestion("certificate");
    const result = reconcileBrokerRecipientSnapshot({
      changeCase: {
        status: "needs_info",
        brokerSubmission: {
          source: "none",
          needsRecipient: true,
          routingStatus: "needs_broker_contact",
        },
        missingInfoQuestions: [question],
        pendingQuestions: [question.question],
        validationIssues: [],
      },
      currentBrokerSubmission: buildBrokerSubmissionFromIdentity(
        brokerIdentity(),
      ),
    });

    expect(result.case.status).toBe("ready_to_submit");
    expect(result.case.missingInfoQuestions).toEqual([]);
    expect(result.case.pendingQuestions).toEqual([]);
    expect(result.case.brokerSubmission).toMatchObject({
      recipientEmail: "tom@montgomeryrisk.com",
      needsRecipient: false,
    });
  });
});
