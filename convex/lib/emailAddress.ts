export function normalizeEmailAddress(email: string): string {
  return email.toLowerCase().trim();
}

export function extractEmailAddress(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match ? normalizeEmailAddress(match[0]) : null;
}
