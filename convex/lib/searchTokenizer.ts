/**
 * Runtime-neutral lexical normalization shared by retrieval and ranking code.
 *
 * NFKC makes compatibility forms comparable while retaining letters and marks
 * from every script. Regex stays isolated here so consumers cannot drift back
 * to incompatible ASCII-only token grammars.
 */
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und");
}

export function tokenizeSearchText(
  value: string,
  options: { minimumLength?: number } = {},
): string[] {
  const minimumLength = options.minimumLength ?? 1;
  return (normalizeSearchValue(value).match(SEARCH_TOKEN_PATTERN) ?? []).filter(
    (token) =>
      Array.from(token).length >= minimumLength || /[^\x00-\x7F]/u.test(token),
  );
}

export function uniqueSearchTerms(
  value: string,
  options: { minimumLength?: number } = {},
): string[] {
  return Array.from(new Set(tokenizeSearchText(value, options)));
}

export function normalizedSearchText(value: string): string {
  return tokenizeSearchText(value).join(" ");
}
