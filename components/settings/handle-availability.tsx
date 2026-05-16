import { Check, Loader2, X } from "lucide-react";

export interface HandleAvailabilityProps {
  /** True while the save mutation is in flight. */
  saving: boolean;
  /** True while the availability query is in flight. */
  checking: boolean;
  /** The current input value (normalized). */
  input: string;
  /** The currently saved handle. */
  current: string;
  /** Availability check result. `undefined` = not run yet. */
  availability: { available: boolean; reason?: string } | null | undefined;
  /** Label shown when input matches the current saved value (e.g. "Current workspace link"). */
  currentLabel: string;
  /** Preview string shown alongside the green "is available" check. Receives the debounced input. */
  renderAvailablePreview?: (input: string) => string;
  /** Minimum length before we stop showing "minimum …" hint. */
  minLength?: number;
}

/**
 * Shared availability-checker status line used under a handle/slug input.
 * Mirrors the workspace-link UX on the Organization settings.
 */
export function HandleAvailability({
  saving,
  checking,
  input,
  current,
  availability,
  currentLabel,
  renderAvailablePreview,
  minLength = 3,
}: HandleAvailabilityProps) {
  const matchesCurrent = input.length >= minLength && input === current;
  const tooShort = input.length > 0 && input.length < minLength;

  let content: React.ReactNode = null;

  if (saving) {
    content = (
      <>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        <span className="text-label-sm text-muted-foreground">Saving…</span>
      </>
    );
  } else if (checking) {
    content = (
      <>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        <span className="text-label-sm text-muted-foreground">Checking…</span>
      </>
    );
  } else if (matchesCurrent) {
    content = (
      <span className="text-label-sm text-muted-foreground/60">{currentLabel}</span>
    );
  } else if (
    input.length >= minLength &&
    input !== current &&
    availability?.available
  ) {
    content = (
      <>
        <Check className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-body-sm text-emerald-600">
          {renderAvailablePreview ? renderAvailablePreview(input) : `${input} is available`}
        </span>
      </>
    );
  } else if (
    input.length >= minLength &&
    input !== current &&
    availability &&
    !availability.available
  ) {
    content = (
      <>
        <X className="w-3.5 h-3.5 text-red-500" />
        <span className="text-body-sm text-red-500">
          {availability.reason ?? "Not available"}
        </span>
      </>
    );
  } else if (tooShort) {
    content = (
      <span className="text-body-sm text-muted-foreground/50">
        Minimum {minLength} characters
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 min-h-5 pt-1">{content}</div>
  );
}
