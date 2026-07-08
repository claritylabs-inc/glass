export function buildAssistantMessageContentWithArtifacts(args: {
  content: string;
  toolArtifacts?: unknown;
  usedTools?: unknown;
  attachments?: unknown;
}): string {
  const content = args.content.trim();
  const usedTools = dedupeStrings(stringArray(args.usedTools));
  const attachedFiles = dedupeStrings(
    attachmentNames(args.attachments),
  );
  const failedFiles = collectAttachmentFailureNames(args.toolArtifacts);

  if (
    usedTools.length === 0 &&
    attachedFiles.length === 0 &&
    failedFiles.length === 0
  ) {
    return args.content;
  }

  const trailerParts: string[] = [];
  if (usedTools.length > 0) {
    trailerParts.push(`tools: ${usedTools.join(", ")}`);
  }
  if (attachedFiles.length > 0) {
    trailerParts.push(`attached: ${attachedFiles.map(quote).join(", ")}`);
  }
  if (failedFiles.length > 0) {
    trailerParts.push(
      `attachment failed: ${failedFiles.map(quote).join(", ")}`,
    );
  }

  return `${content}\n\n[tool activity: ${trailerParts.join("; ")}]`;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    const record = objectRecord(attachment);
    const filename = record?.filename;
    return typeof filename === "string" && filename.trim()
      ? [filename.trim()]
      : [];
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectAttachmentFailureNames(artifacts: unknown): string[] {
  if (!Array.isArray(artifacts)) return [];
  const names: string[] = [];
  for (const artifact of artifacts) {
    const artifactRecord = objectRecord(artifact);
    if (artifactRecord?.type !== "imessage_attachment_delivery") continue;
    const data = objectRecord(artifactRecord.data);
    if (!data || data.status !== "failed") continue;
    const failures = Array.isArray(data.failures) ? data.failures : [];
    for (const failure of failures) {
      const record = objectRecord(failure);
      const filename = record?.filename;
      if (typeof filename === "string" && filename.trim()) {
        names.push(filename.trim());
      }
    }
  }
  return dedupeStrings(names);
}
