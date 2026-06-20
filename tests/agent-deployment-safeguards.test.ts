import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf-8");

describe("agent deployment safeguards", () => {
  it("builds every mission-critical worker before deploys can pass", () => {
    const workflow = read(".github/workflows/agent-safeguards.yml");
    const packageJson = read("package.json");

    expect(workflow).toContain("npm ci && npm run build");
    expect(workflow).toContain("working-directory: imessage-worker");
    expect(workflow).toContain("working-directory: extraction-worker");
    expect(workflow).toContain("node --check mailbox-scan-worker/src/index.js");
    expect(packageJson).toContain("check:agent-workers");
  });

  it("smoke-checks production agent health on a schedule", () => {
    const workflow = read(".github/workflows/agent-safeguards.yml");
    const script = read("scripts/check-agent-deployment-health.mjs");
    const http = read("convex/http.ts");

    expect(workflow).toContain('cron: "*/15 * * * *"');
    expect(workflow).toContain("node scripts/check-agent-deployment-health.mjs");
    expect(workflow).toContain("AGENT_HEALTH_ATTEMPTS: 30");
    expect(script).toContain("https://merry-platypus-82.convex.site/agent-health");
    expect(script).toContain("https://glass-production-4618.up.railway.app/health");
    expect(script).toContain("AGENT_HEALTH_RETRY_DELAY_MS");
    expect(script).toContain("worker is not listening on Railway public target port 3001");
    expect(http).toContain('path: "/agent-health"');
    expect(http).toContain("emailInboundWebhookSecretConfigured");
    expect(http).toContain("imessageWorkerSecretConfigured");
  });
});
