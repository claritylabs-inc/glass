import { describe, expect, test } from "vitest";
import {
  isBlockedImapAddress,
  normalizeImapHost,
  validateImapPort,
  validateResolvedImapAddresses,
} from "./imapDestination";

describe("imapDestination", () => {
  test.each([
    "",
    " imap.gmail.com",
    "imap.gmail.com ",
    "imap gmail.com",
    "https://imap.gmail.com",
    "imap.gmail.com/inbox",
    "imap.gmail.com?debug=true",
    "user:pass@imap.gmail.com",
    "imap.gmail.com:993",
    "[2001:4860:4860::8888]",
  ])("rejects unsafe host input %s", (host) => {
    expect(() => normalizeImapHost(host)).toThrow();
  });

  test("normalizes DNS hosts and public IP literals", () => {
    expect(normalizeImapHost("IMAP.GMAIL.COM")).toBe("imap.gmail.com");
    expect(normalizeImapHost("imap.gmail.com.")).toBe("imap.gmail.com");
    expect(normalizeImapHost("8.8.8.8")).toBe("8.8.8.8");
    expect(normalizeImapHost("2001:4860:4860::8888")).toBe(
      "2001:4860:4860::8888",
    );
  });

  test.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "ff02::1",
  ])("blocks private or reserved address %s", (address) => {
    expect(isBlockedImapAddress(address)).toBe(true);
    expect(() => normalizeImapHost(address)).toThrow(
      "IMAP host must resolve to a public network address",
    );
  });

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
