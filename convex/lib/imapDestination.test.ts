import { describe, expect, test } from "vitest";
import {
  validateImapPort,
  validateResolvedImapAddresses,
} from "./imapDestination";

describe("imapDestination", () => {

  test("restricts connections to known IMAP ports", () => {
    expect(validateImapPort(993)).toBe(993);
    expect(validateImapPort(143)).toBe(143);
    for (const port of [0, 25, 80, 443, 995, 8080, 993.5]) {
      expect(() => validateImapPort(port)).toThrow(
        "Connected email supports IMAP ports 993 and 143 only",
      );
    }
  });

  test("rejects DNS answers that include non-public addresses", () => {
    expect(validateResolvedImapAddresses(["8.8.8.8", "1.1.1.1"])).toEqual([
      "8.8.8.8",
      "1.1.1.1",
    ]);
    expect(() =>
      validateResolvedImapAddresses(["8.8.8.8", "10.0.0.5"]),
    ).toThrow("IMAP host resolves to a private or reserved network address");
  });
});
