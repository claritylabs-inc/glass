"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import type { ToolArtifactData } from "../types";

type Candidate = {
  programId: string;
  programName: string;
  categoryLabel?: string;
  categoryLabels?: string[];
};

type SelectionArtifact = {
  policyId?: string;
  holderName?: string;
  certificateHolder?: string;
  candidates?: Candidate[];
};

function normalizeSelection(data: unknown): SelectionArtifact {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .map((candidate): Candidate | null => {
          if (!candidate || typeof candidate !== "object") return null;
          const candidateRecord = candidate as Record<string, unknown>;
          const programId =
            typeof candidateRecord.programId === "string"
              ? candidateRecord.programId
              : "";
          const programName =
            typeof candidateRecord.programName === "string"
              ? candidateRecord.programName
              : "";
          if (!programId || !programName) return null;
          const normalized: Candidate = {
            programId,
            programName,
          };
          if (typeof candidateRecord.categoryLabel === "string") {
            normalized.categoryLabel = candidateRecord.categoryLabel;
          }
          if (Array.isArray(candidateRecord.categoryLabels)) {
            const categoryLabels = candidateRecord.categoryLabels.filter(
              (value): value is string => typeof value === "string",
            );
            if (categoryLabels.length) normalized.categoryLabels = categoryLabels;
          }
          return normalized;
        })
        .filter((candidate): candidate is Candidate => candidate !== null)
    : [];
  return {
    policyId: typeof record.policyId === "string" ? record.policyId : undefined,
    holderName:
      typeof record.holderName === "string" ? record.holderName : undefined,
    certificateHolder:
      typeof record.certificateHolder === "string"
        ? record.certificateHolder
        : undefined,
    candidates,
  };
}

function candidateSubtitle(candidate: Candidate) {
  return candidate.categoryLabels?.join(", ") || candidate.categoryLabel || "";
}

function CertificateProgramSelectionCard({
  artifact,
}: {
  artifact: ToolArtifactData;
}) {
  const selection = normalizeSelection(artifact.data);
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const [busyProgramId, setBusyProgramId] = useState<string | null>(null);
  const [selectedProgramName, setSelectedProgramName] = useState<string | null>(
    null,
  );

  if (
    artifact.type !== "certificate_program_selection" ||
    !selection.policyId ||
    !selection.holderName ||
    !selection.candidates?.length
  ) {
    return null;
  }

  const handleSelect = async (candidate: Candidate) => {
    setBusyProgramId(candidate.programId);
    try {
      const result = await generateCertificate({
        policyId: selection.policyId as Id<"policies">,
        holderName: selection.holderName ?? "Certificate holder",
        certificateHolder: selection.certificateHolder,
        selectedPartnerProgramId: candidate.programId as Id<"partnerPrograms">,
      });
      setSelectedProgramName(candidate.programName);
      if (result?.status === "pending_approval") {
        toast.success("Certified COI sent for program administrator approval");
      } else {
        toast.success("Certified COI generated");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate COI",
      );
    } finally {
      setBusyProgramId(null);
    }
  };

  return (
    <section className="mt-4 w-full max-w-3xl overflow-hidden rounded-md border border-foreground/8 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground/45" />
          <span className="truncate text-[13px] font-medium text-foreground/85">
            Choose certificate program
          </span>
        </div>
        <Badge
          variant="outline"
          className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55"
        >
          Certified COI
        </Badge>
      </div>
      <div className="space-y-2 px-3 py-3">
        <p className="text-[12px] leading-5 text-muted-foreground/65">
          Glass found multiple possible program administrator programs for this
          policy. Choose one to generate the certified certificate.
        </p>
        <div className="space-y-2">
          {selection.candidates.map((candidate) => {
            const subtitle = candidateSubtitle(candidate);
            const isBusy = busyProgramId === candidate.programId;
            const isSelected = selectedProgramName === candidate.programName;
            return (
              <button
                key={candidate.programId}
                type="button"
                disabled={busyProgramId !== null || isSelected}
                onClick={() => void handleSelect(candidate)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-foreground/8 bg-background px-3 py-2 text-left transition-colors hover:border-foreground/14 disabled:cursor-default disabled:opacity-70"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground/85">
                    {candidate.programName}
                  </span>
                  {subtitle ? (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/50">
                      {subtitle}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-medium ${
                    isSelected
                      ? "bg-foreground text-background"
                      : "border border-foreground/8 text-muted-foreground"
                  }`}
                >
                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {isSelected ? "Selected" : "Use"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function CertificateProgramSelectionArtifacts({
  artifacts,
}: {
  artifacts?: ToolArtifactData[];
}) {
  const selections =
    artifacts?.filter(
      (artifact) => artifact.type === "certificate_program_selection",
    ) ?? [];
  if (selections.length === 0) return null;
  return (
    <>
      {selections.map((artifact, index) => (
        <CertificateProgramSelectionCard
          key={`certificate-program-selection-${index}`}
          artifact={artifact}
        />
      ))}
    </>
  );
}
