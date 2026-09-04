export type OperatorClientPageTab = "overview" | "team" | "settings";

export function parseOperatorClientSection(
  value: string | null,
): OperatorClientPageTab {
  return value === "team" || value === "settings" ? value : "overview";
}
