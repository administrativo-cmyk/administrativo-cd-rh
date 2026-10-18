type OriginPolicy = {
  environment?: string;
  canonicalOrigin?: string;
  allowLoopback?: boolean;
};

const LOCAL_DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function parseSerializedOrigin(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    const parsed = new URL(value);
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) return null;
    return value === parsed.origin ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function isTrustedMutationOrigin(
  request: Request,
  policy: OriginPolicy = {
    environment: process.env.NODE_ENV,
    canonicalOrigin: process.env.APP_ORIGIN,
    allowLoopback: process.env.ALLOW_LOOPBACK_ORIGIN === "1",
  },
): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = parseSerializedOrigin(request.headers.get("origin"));
  if (!origin) return false;

  if (policy.environment === "development") return LOCAL_DEVELOPMENT_ORIGINS.has(origin);

  const canonicalOrigin = parseSerializedOrigin(policy.canonicalOrigin ?? null);
  // Opt-in only for the managed server bound to loopback. Never trust an arbitrary Host header.
  if (policy.allowLoopback && canonicalOrigin && LOCAL_DEVELOPMENT_ORIGINS.has(canonicalOrigin) && origin === canonicalOrigin) {
    const requestUrl = new URL(request.url);
    return LOCAL_DEVELOPMENT_ORIGINS.has(requestUrl.origin);
  }
  return canonicalOrigin !== null && canonicalOrigin.startsWith("https://") && origin === canonicalOrigin;
}
