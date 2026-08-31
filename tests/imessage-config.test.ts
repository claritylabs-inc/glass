import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER",
  "NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER_DISPLAY",
  "NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER",
  "NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER_DISPLAY",
] as const;

const originalValues = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe("Spot iMessage public configuration", () => {
  it("prefers the Spot number and display value", async () => {
    process.env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER = "+14165550100";
    process.env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER_DISPLAY = "(416) 555-0100";
    process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER = "+14165550101";
    process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER_DISPLAY = "(416) 555-0101";

    const config = await import("../lib/imessage-config");

    expect(config.AGENT_TEXT_NUMBER).toBe("+14165550100");
    expect(config.AGENT_TEXT_NUMBER_DISPLAY).toBe("(416) 555-0100");
    expect(config.IMESSAGE_CONTACT_ENABLED).toBe(true);
  });

  it("falls back to the legacy Glass number and display value", async () => {
    delete process.env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER;
    delete process.env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER_DISPLAY;
    process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER = "+14165550101";
    process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER_DISPLAY = "(416) 555-0101";

    const config = await import("../lib/imessage-config");

    expect(config.AGENT_TEXT_NUMBER).toBe("+14165550101");
    expect(config.AGENT_TEXT_NUMBER_DISPLAY).toBe("(416) 555-0101");
    expect(config.IMESSAGE_CONTACT_ENABLED).toBe(true);
  });
});
