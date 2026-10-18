/** Never log the cause's message, stack, query, payload or personal identifiers. */
export function reportOperationalError(operation: string, cause: unknown): string {
  const correlationId = crypto.randomUUID();
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : "UNEXPECTED_FAILURE";
  console.error(JSON.stringify({ operation, correlationId, code: safeCode }));
  return correlationId;
}
