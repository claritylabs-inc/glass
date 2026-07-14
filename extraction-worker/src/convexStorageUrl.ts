const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

type ResolveConvexStorageUrlOptions = {
  glassEnv: string;
  convexUrl: string;
};

/**
 * Native local Convex signs storage URLs with its host-only loopback origin.
 * Containers must use the worker's bridged Convex origin for the same port.
 */
export function resolveConvexStorageUrl(
  storageUrl: string,
  options: ResolveConvexStorageUrlOptions,
): string {
  if (options.glassEnv !== "local") return storageUrl;

  let source: URL;
  let target: URL;
  try {
    source = new URL(storageUrl);
    target = new URL(options.convexUrl);
  } catch {
    return storageUrl;
  }

  if (
    !LOOPBACK_HOSTNAMES.has(source.hostname)
    || source.port !== target.port
    || !["http:", "https:"].includes(source.protocol)
    || !["http:", "https:"].includes(target.protocol)
  ) {
    return storageUrl;
  }

  source.protocol = target.protocol;
  source.host = target.host;
  return source.toString();
}
