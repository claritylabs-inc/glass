// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  conductorContainerName,
  conductorImageTag,
  conductorImageTags,
  repoRoot,
  workspaceSlug,
} from "../scripts/lib/conductor-workspace.mjs";

describe("Conductor workspace identity", () => {
  it("uses the stable worktree directory when the display name changes", () => {
    const originalWorkspaceName = process.env.CONDUCTOR_WORKSPACE_NAME;
    process.env.CONDUCTOR_WORKSPACE_NAME = "renamed-feature-branch";

    try {
      const expectedSlug = path.basename(repoRoot).toLowerCase();
      expect(workspaceSlug()).toBe(expectedSlug);
      expect(conductorImageTag("extraction-worker")).toBe(
        `glass-extraction-worker:conductor-${expectedSlug}`,
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

  it("enumerates every workspace-scoped Apple Container resource", () => {
    const workspace = "/tmp/Glass Feature + QA";

    expect(conductorContainerName("extraction", 8081, workspace)).toBe(
      "glass-extraction-glass-feature-qa-8081",
    );
    expect(conductorImageTags(workspace)).toEqual([
      "glass-extraction-worker:conductor-glass-feature-qa",
      "glass-imessage-worker:conductor-glass-feature-qa",
      "glass-mailbox-scan-worker:conductor-glass-feature-qa",
    ]);
  });
});
