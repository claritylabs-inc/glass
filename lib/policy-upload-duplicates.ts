"use client";

import { toast } from "sonner";

export type PolicyUploadCandidate = {
  file: File;
  fileSha256: string;
};

export type DuplicatePolicyUploadMatch = {
  policyId?: string;
  fileName?: string | null;
  policyNumber?: string | null;
  carrier?: string | null;
};

type CheckDuplicateUpload = (
  fileSha256: string,
) => Promise<DuplicatePolicyUploadMatch | null>;

function hexDigest(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPolicyUploadFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return hexDigest(digest);
}

function duplicateDescription(file: File, duplicate: DuplicatePolicyUploadMatch) {
  const policyLabel =
    [duplicate.carrier, duplicate.policyNumber]
      .filter((value) => value && value !== "Extracting...")
      .join(" · ") || duplicate.fileName || "an existing policy";
  return `"${file.name}" already matches ${policyLabel}.`;
}

function confirmDuplicateUpload(
  file: File,
  duplicate: DuplicatePolicyUploadMatch,
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const id = toast.warning("Possible duplicate upload", {
      description: duplicateDescription(file, duplicate),
      duration: Infinity,
      action: {
        label: "Continue",
        onClick: () => {
          settled = true;
          toast.dismiss(id);
          resolve(true);
        },
      },
      cancel: {
        label: "No",
        onClick: () => {
          settled = true;
          toast.dismiss(id);
          resolve(false);
        },
      },
      onDismiss: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      },
      onAutoClose: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      },
    });
  });
}

export async function preparePolicyUploadCandidates(
  files: File[],
  checkDuplicate: CheckDuplicateUpload,
): Promise<PolicyUploadCandidate[] | null> {
  const candidates: PolicyUploadCandidate[] = [];
  for (const file of files) {
    const fileSha256 = await hashPolicyUploadFile(file);
    const duplicateInBatch = candidates.find(
      (candidate) => candidate.fileSha256 === fileSha256,
    );
    if (
      duplicateInBatch &&
      !(await confirmDuplicateUpload(file, { fileName: duplicateInBatch.file.name }))
    ) {
      return null;
    }
    const duplicate = await checkDuplicate(fileSha256);
    if (duplicate && !(await confirmDuplicateUpload(file, duplicate))) {
      return null;
    }
    candidates.push({ file, fileSha256 });
  }
  return candidates;
}
