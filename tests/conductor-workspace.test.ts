// @vitest-environment node

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canUseAnonymousConvexCloudFallback,
  conductorContainerName,
  conductorContainerNamesOnPort,
  conductorImageTag,
  conductorImageTags,
  conductorPorts,
  conductorLocalRuntimeOverrides,
  containerGateway,
  listenOnContainerGateway,
  localConvexSelectionContents,
  repairLocalConvexSelection,
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

  it("starts Apple container before retrying default-network discovery", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let networkAttempts = 0;
    const gateway = containerGateway({
      startServiceIfNeeded: true,
      runCommand(command: string, args: string[]) {
        calls.push({ command, args });
        if (command === "container") {
          networkAttempts += 1;
          if (networkAttempts === 1) {
            return { status: 1, stdout: "", stderr: "service unavailable" };
          }
          return {
            status: 0,
            stdout: JSON.stringify([
              {
                id: "default",
                status: { ipv4Gateway: "192.168.64.1" },
              },
            ]),
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(gateway).toBe("192.168.64.1");
    expect(calls).toEqual([
      {
        command: "container",
        args: ["network", "list", "--format", "json"],
      },
      {
        command: "/bin/zsh",
        args: ["-c", "yes | container system start"],
      },
      {
        command: "container",
        args: ["network", "list", "--format", "json"],
      },
    ]);
  });

  it("waits for a restarted Apple container gateway to become bindable", async () => {
    const handlers = new Map<string, (value?: unknown) => void>();
    let attempts = 0;
    let elapsed = 0;
    const server = {
      once(event: string, handler: (value?: unknown) => void) {
        handlers.set(event, handler);
      },
      off(event: string, handler: (value?: unknown) => void) {
        if (handlers.get(event) === handler) handlers.delete(event);
      },
      listen() {
        attempts += 1;
        queueMicrotask(() => {
          if (attempts < 3) {
            const error = Object.assign(new Error("address unavailable"), {
              code: "EADDRNOTAVAIL",
            });
            handlers.get("error")?.(error);
            return;
          }
          handlers.get("listening")?.();
        });
      },
    };

    await listenOnContainerGateway(server, {
      gateway: "192.168.64.1",
      port: 55003,
      now: () => elapsed,
      sleep: async (delayMs: number) => {
        elapsed += delayMs;
      },
    });

    expect(attempts).toBe(3);
    expect(elapsed).toBe(500);
  });

  it("launches extraction before waiting for its container gateway", () => {
    const launcher = readFileSync(
      path.join(repoRoot, "scripts/run-local-extraction-container.mjs"),
      "utf8",
    );

    expect(launcher.indexOf('spawn(\n  "container"')).toBeLessThan(
      launcher.indexOf("listenOnContainerGateway(proxy"),
    );
  });
});

describe("Conductor local Convex selection", () => {
  const localConfig = {
    deploymentName: "anonymous-agent",
    ports: { cloud: 55013, site: 55014 },
  };

  it("replaces copied cloud and self-hosted selectors with local values", () => {
    const repaired = localConvexSelectionContents(
      [
        "API_KEY=kept",
        "CONVEX_DEPLOYMENT=dev:acoustic-caiman-755 # team: claritylabs, project: glass",
        "NEXT_PUBLIC_CONVEX_URL=https://acoustic-caiman-755.convex.cloud",
        "NEXT_PUBLIC_CONVEX_SITE_URL=https://acoustic-caiman-755.convex.site",
        "CONVEX_SELF_HOSTED_URL=http://example.test",
        "CONVEX_SELF_HOSTED_ADMIN_KEY=removed",
        "",
      ].join("\n"),
      localConfig,
    );

    expect(repaired).toBe(
      [
        "API_KEY=kept",
        "CONVEX_DEPLOYMENT=anonymous:anonymous-agent",
        "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:55013",
        "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:55014",
        "",
      ].join("\n"),
    );
  });

  it("repairs an existing workspace env file once", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "glass-conductor-"));
    const configDirectory = path.join(
      workspace,
      ".convex",
      "local",
      "default",
    );

    try {
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        path.join(configDirectory, "config.json"),
        JSON.stringify(localConfig),
      );
      writeFileSync(
        path.join(workspace, ".env.local"),
        "CONVEX_DEPLOYMENT=dev:acoustic-caiman-755\n",
      );

      expect(repairLocalConvexSelection(workspace)).toBe(true);
      expect(repairLocalConvexSelection(workspace)).toBe(false);
      expect(readFileSync(path.join(workspace, ".env.local"), "utf8")).toBe(
        [
          "CONVEX_DEPLOYMENT=anonymous:anonymous-agent",
          "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:55013",
          "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:55014",
          "",
        ].join("\n"),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("recovers the workspace port namespace for standalone helper commands", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "glass-conductor-"));
    const configDirectory = path.join(
      workspace,
      ".convex",
      "local",
      "default",
    );
    const previousPort = process.env.CONDUCTOR_PORT;
    delete process.env.CONDUCTOR_PORT;
    try {
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        path.join(configDirectory, "config.json"),
        JSON.stringify({ ports: { cloud: 55003, site: 55004 } }),
      );

      expect(conductorPorts(workspace)).toEqual({
        web: 55000,
        extraction: 55001,
        imessage: 55002,
        convexCloud: 55003,
        convexSite: 55004,
        slack: 55005,
      });
    } finally {
      if (previousPort === undefined) delete process.env.CONDUCTOR_PORT;
      else process.env.CONDUCTOR_PORT = previousPort;
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("repairs the selector before setup or Dev starts Convex", () => {
    const setup = readFileSync(
      path.join(repoRoot, "scripts/setup-conductor-workspace.mjs"),
      "utf8",
    );
    const dev = readFileSync(
      path.join(repoRoot, "scripts/run-conductor-dev.mjs"),
      "utf8",
    );

    expect(setup).toContain("repairLocalConvexSelection()");
    expect(dev).toContain("repairLocalConvexSelection()");
  });

  it("refreshes every port-sensitive local service URL before the web app starts", () => {
    const previousPort = process.env.CONDUCTOR_PORT;
    process.env.CONDUCTOR_PORT = "55000";
    try {
      expect(conductorLocalRuntimeOverrides()).toEqual({
        APP_SITE_URL: "http://localhost:55000",
        AUTH_LINK_SITE_URL: "http://localhost:55000",
        CLIENT_PORTAL_URL: "http://localhost:55000",
        SITE_URL: "http://localhost:55000",
        EXTRACTION_WORKER_URL: "http://127.0.0.1:55001",
        IMESSAGE_WORKER_URL: "http://127.0.0.1:55002",
        SLACK_WORKER_URL: "http://127.0.0.1:55005",
      });
      const launcher = readFileSync(
        path.join(repoRoot, "scripts/run-conductor-web.mjs"),
        "utf8",
      );
      expect(launcher).toContain("conductorLocalRuntimeOverrides()");
      expect(launcher.indexOf("conductorLocalRuntimeOverrides()")).toBeLessThan(
        launcher.indexOf("const child = spawn("),
      );
    } finally {
      if (previousPort === undefined) delete process.env.CONDUCTOR_PORT;
      else process.env.CONDUCTOR_PORT = previousPort;
    }
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
