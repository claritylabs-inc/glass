// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canUseAnonymousConvexCloudFallback,
  conductorContainerName,
  conductorContainerNamesOnPort,
  conductorImageTag,
  conductorImageTags,
  convexDeploymentNameFromDeployKey,
  generateLocalAuthKeys,
  isMissingConvexAccessToken,
  repoRoot,
  resolveConductorClRouterConfig,
  workspaceSlug,
  withoutCloudConvexSelection,
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
      "glass-slack-worker:conductor-glass-feature-qa",
      "glass-mailbox-scan-worker:conductor-glass-feature-qa",
    ]);
  });

  it("finds Glass worker containers occupying an allocated workspace port", () => {
    const containers = [
      { id: "buildkit" },
      { id: "glass-extraction-old-workspace-55061" },
      {
        id: "opaque-runtime-id",
        configuration: {
          id: "glass-extraction-current-workspace-55061",
        },
      },
      { id: "glass-extraction-other-workspace-55071" },
      { id: "unrelated-service-55061" },
    ];

    expect(
      conductorContainerNamesOnPort(containers, "extraction", 55061),
    ).toEqual([
      "glass-extraction-old-workspace-55061",
      "glass-extraction-current-workspace-55061",
    ]);
  });
});

describe("Conductor Convex bootstrap", () => {
  it("recognizes a deployment-scoped key for the configured source", () => {
    expect(
      convexDeploymentNameFromDeployKey(
        "dev:acoustic-caiman-755|secret-token-material",
      ),
    ).toBe("acoustic-caiman-755");
    expect(
      convexDeploymentNameFromDeployKey(
        "prod:merry-platypus-82|secret-token-material",
      ),
    ).toBe("merry-platypus-82");
  });

  it("does not treat project keys or malformed values as deployment keys", () => {
    expect(
      convexDeploymentNameFromDeployKey(
        "project:glass|secret-token-material",
      ),
    ).toBeUndefined();
    expect(convexDeploymentNameFromDeployKey("not-a-key")).toBeUndefined();
    expect(convexDeploymentNameFromDeployKey(undefined)).toBeUndefined();
  });

  it("recognizes the Convex cloud missing-token response", () => {
    expect(
      isMissingConvexAccessToken(
        "Request failed with status 401: MissingAccessToken",
      ),
    ).toBe(true);
    expect(isMissingConvexAccessToken("Request failed with status 503")).toBe(
      false,
    );
  });

  it("allows only credential-free cloud setup to fall back to anonymous Convex", () => {
    const missingToken = "Request failed with status 401: MissingAccessToken";

    expect(
      canUseAnonymousConvexCloudFallback({
        isCloud: true,
        hasDeployKey: false,
        output: missingToken,
      }),
    ).toBe(true);
    expect(
      canUseAnonymousConvexCloudFallback({
        isCloud: false,
        hasDeployKey: false,
        output: missingToken,
      }),
    ).toBe(false);
    expect(
      canUseAnonymousConvexCloudFallback({
        isCloud: true,
        hasDeployKey: true,
        output: missingToken,
      }),
    ).toBe(false);
    expect(
      canUseAnonymousConvexCloudFallback({
        isCloud: true,
        hasDeployKey: false,
        output: "Request failed with status 503",
      }),
    ).toBe(false);
  });

  it("removes cloud selection and credentials from local Convex processes", () => {
    const environment = {
      CONVEX_DEPLOYMENT: "dev:acoustic-caiman-755",
      CONVEX_DEPLOY_KEY: "dev:acoustic-caiman-755|secret-token-material",
      CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY:
        "dev:acoustic-caiman-755|dedicated-secret-token-material",
      CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT: "dev:acoustic-caiman-755",
      CONVEX_SELF_HOSTED_URL: "https://wrong.example.test",
      NEXT_PUBLIC_CONVEX_URL: "https://wrong.example.test",
      UNRELATED_VALUE: "preserved",
    };

    expect(withoutCloudConvexSelection(environment)).toEqual({
      UNRELATED_VALUE: "preserved",
    });
    expect(environment.CONVEX_DEPLOYMENT).toBe("dev:acoustic-caiman-755");
  });

  it("keeps router execution disabled for credential-free cloud setup", () => {
    expect(
      resolveConductorClRouterConfig(
        { url: undefined, tasks: undefined, secret: undefined },
        { required: false },
      ),
    ).toEqual({});
  });

  it("normalizes complete imported router execution settings", () => {
    expect(
      resolveConductorClRouterConfig(
        {
          url: " https://router.example.test ",
          tasks: " extraction,agent ",
          secret: " router-secret ",
        },
        { required: true },
      ),
    ).toEqual({
      url: "https://router.example.test",
      tasks: "extraction,agent",
      secret: "router-secret",
      timeoutMs: "180000",
      tenantId: "glass",
    });
  });

  it("rejects incomplete router execution settings", () => {
    expect(() =>
      resolveConductorClRouterConfig(
        {
          url: "https://router.example.test",
          tasks: undefined,
          secret: undefined,
        },
        { required: false },
      ),
    ).toThrow("CL_ROUTER_TASKS, CL_ROUTER_SECRET must be configured");
  });

  it("generates a self-contained auth keypair for a local deployment", () => {
    const keys = generateLocalAuthKeys();
    const jwks = JSON.parse(keys.JWKS);

    expect(keys.JWT_PRIVATE_KEY).toMatch(/^-----BEGIN PRIVATE KEY----- /);
    expect(keys.JWT_PRIVATE_KEY).not.toContain("\n");
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      use: "sig",
      kty: "RSA",
      e: "AQAB",
    });
    expect(jwks.keys[0].n).toEqual(expect.any(String));
  });
});
