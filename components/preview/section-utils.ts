interface SectionWithSubsections {
  content?: string;
  subsections?: Array<{ title?: string; content?: string }>;
}

/** Build full section content including subsections */
export function buildSectionContent(s: SectionWithSubsections): string {
  let content = s.content ?? "";
  if (s.subsections?.length) {
    for (const sub of s.subsections) {
      content += `\n\n${sub.title ?? ""}`;
      if (sub.content) content += `\n${sub.content}`;
    }
  }
  return content;
}

/** Check if a section title/content matches any of the cited references */
export function matchesCitation(
  title: string,
  citedSections: string[] | undefined,
  content?: string,
): boolean {
  if (!citedSections || citedSections.length === 0) return true;
  const text = `${title} ${content ?? ""}`.toLowerCase();
  return citedSections.some((ref) => text.includes(ref.toLowerCase()));
}
