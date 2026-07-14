// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  conductorImageTag,
  repoRoot,
  workspaceSlug,
} from "../scripts/lib/conductor-workspace.mjs";

describe("Conductor workspace identity", () => {
  it("uses the stable worktree directory when the display name changes", () => {
    const originalWorkspaceName = process.env.CONDUCTOR_WORKSPACE_NAME;
    process.env.CONDUCTOR_WORKSPACE_NAME = "renamed-feature-branch";

    try {
      expect(workspaceSlug()).toBe(path.basename(repoRoot));
      expect(conductorImageTag("extraction-worker")).toBe(
        `glass-extraction-worker:conductor-${path.basename(repoRoot)}`,
      );
    } finally {
      if (originalWorkspaceName === undefined) {
        delete process.env.CONDUCTOR_WORKSPACE_NAME;
      } else {
        process.env.CONDUCTOR_WORKSPACE_NAME = originalWorkspaceName;
      }
    }
  });

  it("sanitizes a worktree directory for container tags", () => {
    expect(workspaceSlug("/tmp/Glass Feature + QA")).toBe(
      "glass-feature-qa",
    );
  });
});
