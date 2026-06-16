import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildPublicDemoBookingUrl,
  buildPublicDemoSystemPrompt,
  PUBLIC_DEMO_BOOKING_URL,
  PUBLIC_DEMO_EXAMPLE_DATA,
  PUBLIC_DEMO_SIGNUP_URL,
} from "../convex/lib/publicDemoAgent";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf-8");

describe("public demo agent", () => {
  it("keeps the prompt constrained to simulated non-binding examples", () => {
    const prompt = buildPublicDemoSystemPrompt({
      channel: "email",
      turnCount: 1,
      latestMessage: "Can you generate a COI?",
      lead: {},
    });

    expect(prompt).toContain(PUBLIC_DEMO_BOOKING_URL);
    expect(prompt).toContain(PUBLIC_DEMO_SIGNUP_URL);
    expect(prompt).toContain(PUBLIC_DEMO_EXAMPLE_DATA.company);
    expect(prompt).toContain("Adyan Tanver");
    expect(prompt).toContain("Terry Wang");
    expect(prompt).toContain("2261 Market Street STE 31584");
    expect(prompt).toContain("Never imply that a demo certificate");
    expect(prompt).toContain("not real insurance advice");
    expect(prompt).toContain("What is your name and company?");
  });

  it("prefills Cal.com with lead context and tracking params", () => {
    const url = new URL(
      buildPublicDemoBookingUrl({
        channel: "imessage",
        lead: {
          name: "Adyan Tanver",
          company: "Clarity Labs",
          email: "adyan@example.com",
          useCase: "vendor compliance",
        },
        notes: "Asked about COIs",
      }),
    );

    expect(url.origin + url.pathname).toBe(PUBLIC_DEMO_BOOKING_URL);
    expect(url.searchParams.get("name")).toBe("Adyan Tanver");
    expect(url.searchParams.get("email")).toBe("adyan@example.com");
    expect(url.searchParams.get("company")).toBe("Clarity Labs");
    expect(url.searchParams.get("notes")).toContain("Company: Clarity Labs");
    expect(url.searchParams.get("notes")).toContain("Use case: vendor compliance");
    expect(url.searchParams.get("utm_source")).toBe("glass_public_demo");
    expect(url.searchParams.get("utm_medium")).toBe("imessage");
    expect(url.searchParams.get("utm_campaign")).toBe("agent_demo");
  });

  it("routes unknown inbound email and iMessage branches through the public demo action", () => {
    const email = read("convex/actions/handleInboundEmail.ts");
    const imessage = read("convex/actions/handleInboundImessage.ts");

    expect(email).toContain("internal.actions.publicDemoAgent.respond");
    expect(email).toContain("if (handle !== \"agent\") return");
    expect(email).not.toContain("buildUnrecognizedInboundEmail");
    expect(imessage).toContain("scope.kind === \"no_linked_users\"");
    expect(imessage).toContain("internal.actions.publicDemoAgent.respond");
  });

  it("keeps public demo storage separate from tenant threads and real certificate tables", () => {
    const schema = read("convex/schema.ts");
    const action = read("convex/actions/publicDemoAgent.ts");

    expect(schema).toContain("publicDemoConversations: defineTable");
    expect(schema).toContain("publicDemoChatLogs: defineTable");
    expect(schema).toContain("publicDemoSalesTranscripts: defineTable");
    expect(action).not.toContain("internal.certificates");
    expect(action).not.toContain("internal.actions.generateCoi");
    expect(action).not.toContain("internal.threads.findOrCreate");
  });

  it("adds deterministic public-demo safety checks after model generation", () => {
    const action = read("convex/actions/publicDemoAgent.ts");

    expect(action).toContain("addSimulationNotice");
    expect(action).toContain("no certificate was issued");
    expect(action).toContain("not insurance advice");
    expect(action).toContain("responseText.includes(PUBLIC_DEMO_BOOKING_URL)");
  });

  it("adds a simple operator archive surface for demo chats", () => {
    const sidebar = read("app/operator/operator-sidebar.tsx");
    const page = read("app/operator/demo-leads/page.tsx");
    const cache = read("lib/sync/operator-cached-queries.ts");
    const operator = read("convex/operator.ts");

    expect(sidebar).toContain("/operator/demo-leads");
    expect(sidebar).toContain("Demo leads");
    expect(page).toContain("ActionSurfaceButton");
    expect(page).toContain("No public demo chats");
    expect(page).toContain("SettingsDrawer");
    expect(page).not.toContain("Tabs");
    expect(page).not.toContain("Table");
    expect(page).not.toContain("@/components/ui/select");
    expect(page).not.toContain("<Select");
    expect(cache).toContain("useCachedOperatorDemoSalesTranscripts");
    expect(cache).not.toContain("useCachedOperatorDemoChatLogs");
    expect(operator).toContain("listPublicDemoSalesTranscripts");
    expect(operator).toContain("getPublicDemoSalesTranscript");
  });

  it("adds an org-less model helper that uses operator global defaults before static routing", () => {
    const settings = read("convex/modelSettings.ts");
    const models = read("convex/lib/models.ts");

    expect(settings).toContain("resolvePublicDefaults");
    expect(settings).toContain("globalSettings?.routes?.[task]");
    expect(models).toContain("getModelAndRouteForPublicTask");
    expect(models).toContain("internal.modelSettings.resolvePublicDefaults");
  });
});
