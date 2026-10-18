import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { SupabaseDailyCallRepository } from "@/lib/data/supabase-daily-call-repository";
import { SupabaseTimeBankRepository } from "@/lib/data/supabase-time-bank-repository";
import { SupabaseWorkforceRepository } from "@/lib/data/supabase-workforce-repository";
import { filtersSchema, type MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { loadMonitoring } from "@/lib/monitoring/server";
import { dashboardSnapshotSchema, parseDashboardFilters, type DashboardDomain, type DashboardFilters, type DashboardSnapshot } from "./contracts";
import { buildDailyCallDashboard, buildMonitoringDashboard, buildTimeBankDashboard, buildWorkforceDashboard } from "./selectors";

const MAX_MONITORING_ROWS = 20_000;
const MONITORING_PAGE_SIZE = 500;
const headers = { "Cache-Control": "private, no-store" };
export class DashboardError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function readDashboardSession(signal: AbortSignal) {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const userId = error ? null : data?.claims?.sub;
  if (typeof userId !== "string") return { response: Response.json({ error: "Sessão necessária." }, { status: 401, headers }) } as const;
  const { data: profile } = await client.from("perfis").select("status_usuario,papel_usuario").eq("id", userId).abortSignal(signal).single();
  if (!profile || profile.status_usuario !== "APROVADO" || !profile.papel_usuario || !["ADMIN", "RH", "GESTOR", "LEITURA"].includes(profile.papel_usuario)) {
    return { response: Response.json({ error: "Acesso não autorizado." }, { status: 403, headers }) } as const;
  }
  return { userId, role: profile.papel_usuario } as const;
}

export async function dashboardSession() {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = () => ({ response: Response.json({ error: "Não foi possível validar a sessão. Tente novamente." }, { status: 503, headers }) } as const);
  const timeout = new Promise<ReturnType<typeof unavailable>>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(unavailable()); }, 15_000);
  });
  try { return await Promise.race([readDashboardSession(controller.signal), timeout]); }
  catch { return unavailable(); }
  finally { clearTimeout(timer); controller.abort(); }
}

async function monitoringPages(filters: DashboardFilters, signal: AbortSignal): Promise<MonitoringSnapshot> {
  const query = filtersSchema.parse({ start: filters.start, end: filters.end, unit: filters.unit, managerId: filters.managerId === "none" ? "" : filters.managerId, limit: MONITORING_PAGE_SIZE });
  const first = await loadMonitoring(query, signal);
  if (first.total > MAX_MONITORING_ROWS) throw new DashboardError("DASHBOARD_TOO_LARGE", 422);
  if (!first.datasetVersion) throw new DashboardError("DASHBOARD_SOURCE_CHANGED", 409);
  const rows = [...first.rows];
  const offsets: number[] = [];
  for (let offset = MONITORING_PAGE_SIZE; offset < first.total; offset += MONITORING_PAGE_SIZE) offsets.push(offset);
  // Bound concurrent requests; the revision prevents mixing pages from different runs.
  for (let index = 0; index < offsets.length; index += 4) {
    if (signal.aborted) throw new DashboardError("DASHBOARD_TIMEOUT", 503);
    const pages = await Promise.all(offsets.slice(index, index + 4).map((offset) => loadMonitoring({ ...query, offset }, signal)));
    for (const page of pages) {
      if (page.datasetVersion !== first.datasetVersion || page.total !== first.total) throw new DashboardError("DASHBOARD_SOURCE_CHANGED", 409);
      rows.push(...page.rows);
    }
  }
  if (rows.length !== first.total || new Set(rows.map((row) => `${row.employeeId}|${row.date ?? "pending"}`)).size !== rows.length) {
    throw new DashboardError("DASHBOARD_SOURCE_CHANGED", 409);
  }
  return { ...first, rows };
}

async function monitoringSource(filters: DashboardFilters): Promise<MonitoringSnapshot> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DashboardError("DASHBOARD_TIMEOUT", 503));
    }, 25_000);
  });
  try { return await Promise.race([monitoringPages(filters, controller.signal), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

/** All repositories use the user's cookie session and enforce scope in their RPC. */
export async function loadDashboard(domain: DashboardDomain, input: Partial<DashboardFilters> = {}): Promise<DashboardSnapshot> {
  const filters = parseDashboardFilters(domain, input, todayInSaoPaulo());
  const queriedAt = new Date().toISOString();
  let snapshot: DashboardSnapshot;
  if (domain === "monitoramento") {
    snapshot = buildMonitoringDashboard(await monitoringSource(filters), filters, queriedAt);
  } else if (domain === "chamada-diaria") {
    const [daily, workforce] = await Promise.all([
      new SupabaseDailyCallRepository().load(filters.end, filters.start, filters.end),
      new SupabaseWorkforceRepository().load(),
    ]);
    snapshot = buildDailyCallDashboard(daily, workforce, filters, queriedAt);
  } else if (domain === "banco-de-horas") {
    snapshot = buildTimeBankDashboard(await new SupabaseTimeBankRepository().load(filters.end), filters, queriedAt);
  } else {
    snapshot = buildWorkforceDashboard(await new SupabaseWorkforceRepository().load(), filters, queriedAt);
  }
  return dashboardSnapshotSchema.parse(snapshot);
}
