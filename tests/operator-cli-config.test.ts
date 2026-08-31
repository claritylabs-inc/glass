import { afterEach, describe, expect, it } from "vitest";

import { resolveProfile } from "../operator-cli/src/config";

const originalSpotProfile = process.env.SPOT_OPERATOR_PROFILE;
const originalGlassProfile = process.env.GLASS_OPERATOR_PROFILE;

afterEach(() => {
  if (originalSpotProfile === undefined) delete process.env.SPOT_OPERATOR_PROFILE;
  else process.env.SPOT_OPERATOR_PROFILE = originalSpotProfile;
  if (originalGlassProfile === undefined) delete process.env.GLASS_OPERATOR_PROFILE;
  else process.env.GLASS_OPERATOR_PROFILE = originalGlassProfile;
});

describe("operator CLI profile resolution", () => {
  it("prefers explicit and Spot profile selections", () => {
    process.env.SPOT_OPERATOR_PROFILE = "spot-profile";
    process.env.GLASS_OPERATOR_PROFILE = "legacy-profile";

    expect(resolveProfile("explicit-profile")).toBe("explicit-profile");
    expect(resolveProfile()).toBe("spot-profile");
  });

  it("falls back to the legacy Glass profile selector", () => {
    delete process.env.SPOT_OPERATOR_PROFILE;
    process.env.GLASS_OPERATOR_PROFILE = "legacy-profile";

    expect(resolveProfile()).toBe("legacy-profile");
  });
});
