export function normalizeEmailAddress(email: string): string {
  return email.toLowerCase().trim();
}

export function extractEmailAddress(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match ? normalizeEmailAddress(match[0]) : null;
}

export function parseStandaloneEmailAddress(value: string): string | null {
  let candidate = value.trim();
  while ([".", "!", "?"].includes(candidate.at(-1) ?? "")) {
    candidate = candidate.slice(0, -1).trimEnd();
  }
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  const parsed = standaloneEmailAddressSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
import { z } from "zod";

const standaloneEmailAddressSchema = z.string().trim().toLowerCase().email();
