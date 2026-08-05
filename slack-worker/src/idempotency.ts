import dayjs from "dayjs";

export type SendResult = {
  messageId?: string;
  attachmentFailures: Array<{ filename: string; error: string }>;
};

type Entry =
  | { status: "sending"; expiresAt: number }
  | { status: "sent"; expiresAt: number; result: SendResult };

export class SendIdempotency {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ttlMs = 10 * 60 * 1_000) {}

  claim(key: string): { claimed: true } | { claimed: false; result?: SendResult } {
    this.prune();
    const existing = this.entries.get(key);
    if (existing) {
      return existing.status === "sent"
        ? { claimed: false, result: existing.result }
        : { claimed: false };
    }
    this.entries.set(key, {
      status: "sending",
      expiresAt: dayjs().add(this.ttlMs, "millisecond").valueOf(),
    });
    return { claimed: true };
  }

  complete(key: string, result: SendResult) {
    this.entries.set(key, {
      status: "sent",
      expiresAt: dayjs().add(this.ttlMs, "millisecond").valueOf(),
      result,
    });
  }

  release(key: string) {
    if (this.entries.get(key)?.status === "sending") this.entries.delete(key);
  }

  private prune() {
    const now = dayjs().valueOf();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
