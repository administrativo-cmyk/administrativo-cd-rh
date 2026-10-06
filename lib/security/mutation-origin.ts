type OriginPolicy = {
  environment?: string;
  canonicalOrigin?: string;
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
  },
): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = parseSerializedOrigin(request.headers.get("origin"));
  if (!origin) return false;

  if (policy.environment === "development") return LOCAL_DEVELOPMENT_ORIGINS.has(origin);

  const canonicalOrigin = parseSerializedOrigin(policy.canonicalOrigin ?? null);
  return canonicalOrigin !== null && canonicalOrigin.startsWith("https://") && origin === canonicalOrigin;
}
