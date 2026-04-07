/**
 * Format org memories into a context block for system prompts.
 */
export function buildMemoryContext(
  memories: Array<{
    type: string;
    content: string;
    source: string;
    updatedAt: number;
  }>,
): string {
  if (!memories || memories.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m.content);
  }

  const typeLabels: Record<string, string> = {
    fact: "Known facts",
    preference: "Client preferences",
    risk_note: "Risk observations",
    observation: "General observations",
  };

  const sections: string[] = [];
  for (const [type, items] of Object.entries(grouped)) {
    const label = typeLabels[type] || type;
    sections.push(`${label}:\n${items.map((i) => `- ${i}`).join("\n")}`);
  }

  return `\n\nORG KNOWLEDGE:\n${sections.join("\n\n")}`;
}
