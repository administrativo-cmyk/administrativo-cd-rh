import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

// Read-only diagnosis. Never prints tokens, keys, cookies or backend messages.
const fileEnv = parseEnv(await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => ""));
const env = { ...fileEnv, ...process.env };
const required = ["MONITORING_INGEST_TOKEN", "MONITORING_INGEST_SOURCE_IDS", "MONITORING_SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((name) => !env[name]?.trim());
const result = {
  mode: "read-only",
  projectHost: env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname : null,
  localServer: "unreachable",
  monitoringDatabase: "not-checked",
  missingServerVariables: missing,
  tokenLengthValid: (env.MONITORING_INGEST_TOKEN?.length ?? 0) >= 32,
};
try {
  const response = await fetch("http://localhost:3000/login", { redirect: "manual", signal: AbortSignal.timeout(10000) });
  result.localServer = `http-${response.status}`;
} catch { /* Keep the non-sensitive unreachable status. */ }
if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  try {
    const url = new URL("/rest/v1/rpc/monitoring_query", env.NEXT_PUBLIC_SUPABASE_URL);
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_action: "summary", p_data: { start: "2026-10-01", end: "2026-10-01" } }),
    });
    const body = await response.json().catch(() => null);
    result.monitoringDatabase = body?.code === "PGRST202" ? "installation-missing"
      : body?.code === "42501" ? "rpc-present-anonymous-denied"
      : response.ok ? "unexpected-anonymous-access" : `http-${response.status}`;
  } catch { result.monitoringDatabase = "unreachable"; }
}
console.log(JSON.stringify(result, null, 2));
if (result.monitoringDatabase === "unexpected-anonymous-access") process.exitCode = 1;
