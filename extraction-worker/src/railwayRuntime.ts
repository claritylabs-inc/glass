const ACTIVE_RAILWAY_ENVIRONMENTS = new Set([
  "dev",
  "production",
]);

export type WorkerRuntimeAccess = {
  mode: "active" | "health_only";
  railwayEnvironment?: string;
  jobsEnabled: boolean;
  conversionsEnabled: boolean;
};

export function resolveWorkerRuntimeAccess(
  env: NodeJS.ProcessEnv,
): WorkerRuntimeAccess {
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME?.trim();
  if (
    !railwayEnvironment
    || ACTIVE_RAILWAY_ENVIRONMENTS.has(railwayEnvironment.toLowerCase())
  ) {
    return {
      mode: "active",
      railwayEnvironment: railwayEnvironment || undefined,
      jobsEnabled: true,
      conversionsEnabled: true,
    };
  }

  return {
    mode: "health_only",
    railwayEnvironment,
    jobsEnabled: false,
    conversionsEnabled: false,
  };
}
