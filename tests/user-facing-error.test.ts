import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

import {
  getPermissionErrorMessage,
  getUserFacingErrorCode,
  getUserFacingErrorMessage,
} from "@/lib/user-facing-error";

describe("user-facing error messages", () => {
  test("preserves structured permission feedback and code", () => {
    const error = new ConvexError({
      category: "permission",
      code: "ORG_ADMIN_REQUIRED",
      message: "Only an organization admin can run a deeper compliance check.",
    });

    expect(getPermissionErrorMessage(error)).toBe(
      "Only an organization admin can run a deeper compliance check.",
    );
    expect(getUserFacingErrorMessage(error, "Deeper check failed")).toBe(
      "Only an organization admin can run a deeper compliance check.",
    );
    expect(getUserFacingErrorCode(error)).toBe("ORG_ADMIN_REQUIRED");
  });

  test("recognizes structured errors after transport removes the prototype", () => {
    const error = {
      data: {
        category: "permission",
        code: "IMPERSONATION_READ_ONLY",
        message: "This operator session is read-only.",
      },
    };

    expect(getUserFacingErrorMessage(error, "Could not save")).toBe(
      "This operator session is read-only.",
    );
  });

  test("masks opaque Convex server wrappers", () => {
    const error = new Error(
      "[CONVEX A(actions/complianceReview:recheckOwnRequirement)] [Request ID: 79453de80c006a69] Server Error Called by client",
    );

    expect(getUserFacingErrorMessage(error, "Deeper check failed")).toBe(
      "Deeper check failed",
    );
  });

  test("normalizes legacy permission errors while old deployments roll out", () => {
    const error = new Error("Uncaught Error: Broker admin access required");

    expect(getUserFacingErrorMessage(error, "Could not save")).toBe(
      "Only a broker admin can perform this action.",
    );
  });

  test("preserves useful non-permission errors", () => {
    expect(
      getUserFacingErrorMessage(
        new Error("Mailbox credentials were rejected."),
        "Could not connect mailbox",
      ),
    ).toBe("Mailbox credentials were rejected.");
  });
});
