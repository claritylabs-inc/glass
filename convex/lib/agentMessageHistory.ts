import {
  formatCertificateProgramSelectionForModel,
  type CertificateProgramSelection,
} from "./certificateProgramSelection";

type ToolArtifactLike = { type?: string; data?: unknown };

export function buildAssistantMessageContentWithArtifacts(args: {
  content: string;
  toolArtifacts?: unknown;
}): string {
  const selectionContext = certificateProgramSelectionContext(args.toolArtifacts);
  return selectionContext ? `${args.content}\n\n${selectionContext}` : args.content;
}

function certificateProgramSelectionContext(toolArtifacts: unknown): string {
  if (!Array.isArray(toolArtifacts)) return "";

  return (toolArtifacts as ToolArtifactLike[])
    .filter((artifact) => artifact.type === "certificate_program_selection")
    .map((artifact) =>
      formatCertificateProgramSelectionForModel(
        artifact.data as CertificateProgramSelection,
      ),
    )
    .join("\n\n");
}
