import { Doc } from "../_generated/dataModel";

export type CompletionStatus = {
  core: boolean;
  requiredExtras: boolean;
  missingSections: string[];
};

// completedExtras is an optional array the caller builds from which side tables have rows.
export function resolveCompletionStatus(
  passport: Pick<Doc<"clientPassport">, "coreCompletedAt"> & {
    _completedExtras?: string[];
  },
  requiredSections: string[]
): CompletionStatus {
  const core = !!passport.coreCompletedAt;
  const completedExtras = passport._completedExtras ?? [];
  const extraRequired = requiredSections.filter(
    (s) =>
      !["applicant_info", "nature_of_business", "locations", "general_info"].includes(s)
  );
  const missingSections = extraRequired.filter(
    (s) => !completedExtras.includes(s)
  );
  return {
    core,
    requiredExtras: missingSections.length === 0,
    missingSections,
  };
}
