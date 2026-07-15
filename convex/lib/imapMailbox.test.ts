// @vitest-environment node

import { Readable } from "node:stream";
import type { ImapFlow } from "imapflow";
import { describe, expect, test } from "vitest";
import {
  fetchParsedMessage,
  MailboxMessageUnavailableError,
  resolveParsedMessage,
} from "./imapMailbox";

function rawMessage(subject: string, messageId = "<message@example.com>") {
  return Buffer.from([
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    "From: broker@example.com",
    "To: user@example.com",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Message body",
  ].join("\r\n"));
}

describe("IMAP mailbox message resolution", () => {
  test("reports a missing UID as an unavailable message", async () => {
    const client = {
      mailboxOpen: async () => undefined,
      download: async () => ({}),
    } as unknown as ImapFlow;

    await expect(fetchParsedMessage(client, "INBOX", 42)).rejects.toBeInstanceOf(
      MailboxMessageUnavailableError,
    );
  });

  test("resolves a moved message by Message-ID in the provider's all-mail folder", async () => {
    let currentMailbox = "";
    const message = rawMessage("Moved policy email");
    const client = {
      mailboxOpen: async (mailbox: string) => {
        currentMailbox = mailbox;
        return undefined;
      },
      download: async (uid: string) => {
        if (currentMailbox === "Archive" && uid === "84") {
          return {
            meta: { expectedSize: message.length, contentType: "message/rfc822" },
            content: Readable.from([message]),
          };
        }
        return {};
      },
      list: async () => [
        {
          path: "Archive",
          flags: new Set<string>(),
          specialUse: "\\All",
          listed: true,
        },
      ],
      search: async (criteria: { header?: Record<string, string> }) => {
        expect(criteria.header).toEqual({ "Message-ID": "<message@example.com>" });
        return currentMailbox === "Archive" ? [84] : [];
      },
    } as unknown as ImapFlow;

    const result = await resolveParsedMessage(client, {
      mailbox: "INBOX",
      uid: 42,
      messageId: "<message@example.com>",
    });

    expect(result).toMatchObject({ mailbox: "Archive", uid: 84 });
    expect(result.parsed.subject).toBe("Moved policy email");
  });

  test("keeps the unavailable error when Message-ID lookup finds no live copy", async () => {
    const client = {
      mailboxOpen: async () => undefined,
      download: async () => ({}),
      list: async () => [],
      search: async () => [],
    } as unknown as ImapFlow;

    await expect(
      resolveParsedMessage(client, {
        mailbox: "INBOX",
        uid: 42,
        messageId: "<missing@example.com>",
      }),
    ).rejects.toThrow("It may have been moved or deleted");
  });

  test("does not accept a reused UID whose Message-ID belongs to another email", async () => {
    let currentMailbox = "";
    const wrongMessage = rawMessage("Wrong email", "<wrong@example.com>");
    const expectedMessage = rawMessage("Expected email", "<expected@example.com>");
    const client = {
      mailboxOpen: async (mailbox: string) => {
        currentMailbox = mailbox;
        return undefined;
      },
      download: async (uid: string) => {
        const message = currentMailbox === "INBOX" && uid === "42"
          ? wrongMessage
          : currentMailbox === "Archive" && uid === "84"
            ? expectedMessage
            : undefined;
        return message
          ? {
              meta: { expectedSize: message.length, contentType: "message/rfc822" },
              content: Readable.from([message]),
            }
          : {};
      },
      list: async () => [
        {
          path: "Archive",
          flags: new Set<string>(),
          specialUse: "\\All",
          listed: true,
        },
      ],
      search: async () => currentMailbox === "Archive" ? [84] : [],
    } as unknown as ImapFlow;

    const result = await resolveParsedMessage(client, {
      mailbox: "INBOX",
      uid: 42,
      messageId: "<expected@example.com>",
    });

    expect(result).toMatchObject({ mailbox: "Archive", uid: 84 });
    expect(result.parsed.subject).toBe("Expected email");
  });
});
