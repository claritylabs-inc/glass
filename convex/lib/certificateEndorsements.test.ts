import { describe, expect, it } from "vitest";

import { buildEndorsementDescription } from "./certificateEndorsements";

describe("certificate endorsements", () => {

  it("composes source-backed remarks without inventing forms", () => {
    expect(
      buildEndorsementDescription([
        {
          kind: "primary_non_contributory",
          formNumbers: [],
          requiresWrittenContract: false,
        },
      ]),
    ).toContain("blanket endorsement on the policy");
  });
});
