import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf-8");

describe("agent deployment safeguards", () => {
  it("builds every mission-critical worker before deploys can pass", () => {
    const workflow = read(".github/workflows/agent-safeguards.yml");
    const packageJson = read("package.json");

    expect(workflow).toContain(
      "npm ci --include=dev --no-audit --no-fund --loglevel=error && npm run build",
    );
    expect(workflow).toContain("working-directory: imessage-worker");
    expect(workflow).toContain("working-directory: extraction-worker");
    expect(workflow).toContain("node --check mailbox-scan-worker/src/index.js");
    expect(packageJson).toContain("check:agent-workers");
  });

  it("requires validation gates before Convex deploy and package publish", () => {
    const ci = read(".github/workflows/ci.yml");
    const deploy = read(".github/workflows/deploy-convex.yml");

    for (const gate of [
      "npm run check:cl-sdk-version",
      "npm run lint",
      "npm test",
      "npx tsc --noEmit --incremental false",
      "npx convex typecheck",
      "npm run build",
      "working-directory: extraction-worker",
      "working-directory: imessage-worker",
      "working-directory: mcp-server",
      "node --check mailbox-scan-worker/src/index.js",
      "package:\n          - cli\n          - operator-cli",
    ]) {
      expect(ci).toContain(gate);
      expect(deploy).toContain(gate);
    }

    expect(deploy).toContain("validate-root:");
    expect(deploy).toContain("validate-workers:");
    expect(deploy).toContain("validate-packages:");
    expect(deploy).toContain("needs:\n      - validate-root\n      - validate-workers\n      - validate-packages");
    expect(deploy).toContain("publish-cli:");
    expect(deploy).toContain("publish-operator-cli:");
    const publishCli = deploy.slice(
      deploy.indexOf("publish-cli:"),
      deploy.indexOf("publish-operator-cli:"),
    );
    const publishOperatorCli = deploy.slice(deploy.indexOf("publish-operator-cli:"));
    expect(publishCli).toContain("needs: deploy");
    expect(publishOperatorCli).toContain("needs: deploy");
  });

  it("smoke-checks production agent health on a schedule", () => {
    const workflow = read(".github/workflows/agent-safeguards.yml");
    const script = read("scripts/check-agent-deployment-health.mjs");
    const deployments = read("config/deployments.json");
    const http = read("convex/http.ts");

    expect(workflow).toContain('cron: "*/15 * * * *"');
    expect(workflow).toContain("node scripts/check-agent-deployment-health.mjs");
    expect(workflow).toContain("AGENT_HEALTH_ATTEMPTS: 30");
    expect(deployments).toContain("https://merry-platypus-82.convex.site/agent-health");
    expect(deployments).toContain("https://glass-production-4618.up.railway.app/health");
    expect(deployments).toContain("GLASS_STAGING_CONVEX_AGENT_HEALTH_URL");
    expect(script).toContain("config/deployments.json");
    expect(script).toContain("AGENT_HEALTH_RETRY_DELAY_MS");
    expect(script).toContain("worker is not listening on required port");
    expect(http).toContain('path: "/agent-health"');
    expect(http).toContain("emailInboundWebhookSecretConfigured");
    expect(http).toContain("imessageWorkerSecretConfigured");
    expect(http).toContain("emailOutboundConfigured");
  });
});
