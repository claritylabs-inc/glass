import { describe, expect, test } from "vitest";
import {
  parseTerminalIdentityCommand,
  terminalIdentityLabel,
} from "../imessage-worker/src/terminalIdentity";

const aliases = {
  broker: "+16472921666",
  client: "+12025550102",
  public: "+12025550199",
};

describe("Spectrum terminal identity commands", () => {
  test("switches between seeded and public aliases", () => {
    expect(parseTerminalIdentityCommand("/as broker", aliases)).toEqual({
      kind: "switch",
      label: "broker",
      phone: "+16472921666",
    });
    expect(parseTerminalIdentityCommand("/as CLIENT", aliases)).toEqual({
      kind: "switch",
      label: "client",
      phone: "+12025550102",
    });
    expect(parseTerminalIdentityCommand("/as public", aliases)).toEqual({
      kind: "switch",
      label: "public",
      phone: "+12025550199",
    });
  });

  test("accepts explicit E.164 senders and rejects invalid identities", () => {
    expect(parseTerminalIdentityCommand("/as +14155550100", aliases)).toEqual({
      kind: "switch",
      label: "+14155550100",
      phone: "+14155550100",
    });
    expect(parseTerminalIdentityCommand("/as unknown", aliases)).toEqual({
      kind: "error",
      message:
        "Unknown identity. Use broker, client, public, or a valid E.164 phone number.",
    });
  });

  test("reports the active alias and ignores normal messages", () => {
    expect(parseTerminalIdentityCommand("/whoami", aliases)).toEqual({
      kind: "whoami",
    });
    expect(terminalIdentityLabel("+12025550102", aliases)).toBe("client");
    expect(parseTerminalIdentityCommand("show me my policies", aliases)).toBeNull();
  });
});
