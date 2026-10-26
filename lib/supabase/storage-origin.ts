/** Explicitly configured origins only; never derive a credential destination from request data. */
export function isTrustedSupabaseStorageOrigin(origin: URL, projectRef?: string): boolean {
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) return false;
  if (projectRef !== undefined && !/^[a-z]{20}$/.test(projectRef)) return false;
  const managed = origin.hostname.match(/^([a-z]{20})\.supabase\.co$/)?.[1];
  if (managed) return !origin.port && (projectRef === undefined || projectRef === managed);

  const configured = process.env.SUPABASE_SELF_HOSTED_ORIGIN;
  if (!configured) return false;
  try {
    const trusted = new URL(configured);
    if (trusted.protocol !== "https:" || trusted.pathname !== "/" || trusted.username || trusted.password || trusted.search || trusted.hash) return false;
    return origin.href === trusted.href
      && (projectRef === undefined || projectRef === process.env.MONITORING_SUPABASE_PROJECT_REF);
  } catch { return false; }
}

export function configuredSupabaseProjectRef(url: string): string {
  const origin = new URL(url);
  const projectRef = process.env.MONITORING_SUPABASE_PROJECT_REF ?? origin.hostname.split(".")[0];
  if (!isTrustedSupabaseStorageOrigin(origin, projectRef)) throw new Error("ARCHIVE_PROJECT_MISMATCH");
  return projectRef;
}
