export function slackRetryDelayMs(error: string, attemptCount: number) {
  const retryAfterSeconds = Number(
    error.match(/retry after\s+(\d+(?:\.\d+)?)s/i)?.[1],
  );
  const providerDelay = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1_000
    : 0;
  return Math.max(2 ** attemptCount * 1_000, providerDelay);
}
