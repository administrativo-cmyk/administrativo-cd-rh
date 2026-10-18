import { z } from "zod";
import type { AdministrationSnapshot, AdministrationVacation } from "@/lib/administration/contracts";
import { validDate } from "@/lib/data/daily-call-dates";

export type VacationCalendarFilters = { month: string; managerId: string; unitId: string; status: string; query: string };
export type VacationCalendarSnapshot = AdministrationSnapshot<"vacation">;
export const vacationStatusLabels = { draft: "Rascunho", requested: "Solicitado", approved: "Aprovado", cancelled: "Cancelado" } as const;
const date = z.string().refine(validDate);
const id = z.string().uuid();
const snapshotSchema = z.object({
  entity: z.literal("vacation"), datasetVersion: z.string().min(1), total: z.number().int().nonnegative(),
  rows: z.array(z.object({
    id, employeeId: id, employeeName: z.string(), employeeNumber: z.string(), managerId: id.nullable(), unitId: id,
    startDate: date, endDate: date, status: z.enum(["draft", "requested", "approved", "cancelled"]),
    acquisitionStart: date.nullable(), acquisitionEnd: date.nullable(), observation: z.string().nullable(),
    updatedAt: z.string(), createdAt: z.string(), archivedAt: z.string().nullable(), createdBy: z.string(),
    approvedBy: z.string().nullable(), approvedAt: z.string().nullable(), canEdit: z.boolean(),
  }).refine(row => row.endDate >= row.startDate)),
  options: z.object({
    units: z.array(z.object({ id, code: z.string(), name: z.string(), active: z.boolean() })),
    managers: z.array(z.object({ id, name: z.string(), active: z.boolean() })),
    employees: z.array(z.object({ id, name: z.string(), employeeNumber: z.string(), managerId: id.nullable(), unitId: id, activeInSystem: z.boolean() })),
  }),
  permissions: z.object({ canManageRegisters: z.boolean(), canApproveVacation: z.boolean(), canProposeVacation: z.boolean() }),
});

/** Publish a complete result only; never render the first page as monthly totals. */
export async function loadVacationCalendar(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<VacationCalendarSnapshot> {
  let snapshot: VacationCalendarSnapshot | null = null;
  const rows: AdministrationVacation[] = [];
  const ids = new Set<string>();
  do {
    const response = await fetcher("/api/administration", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "vacation", action: "list", data: { offset: rows.length, limit: 500, includeArchived: false } }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Não foi possível consultar as programações de férias.";
      throw new Error(message);
    }
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) throw new Error("A consulta retornou dados incompletos. Atualize e tente novamente.");
    const page = parsed.data;
    if (snapshot && (page.total !== snapshot.total || page.datasetVersion !== snapshot.datasetVersion)) throw new Error("As programações mudaram durante a consulta. Atualize para obter a contagem completa.");
    snapshot ??= page;
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error("As programações mudaram durante a consulta. Atualize para obter a contagem completa.");
      ids.add(row.id); rows.push(row);
    }
    if (rows.length > page.total || (rows.length < page.total && (!page.rows.length || rows.length > 100000))) {
      throw new Error("Não foi possível carregar todas as programações. Atualize antes de usar as contagens.");
    }
  } while (rows.length < snapshot.total);
  return { ...snapshot, rows };
}

export function monthDays(month: string): string[] {
  const start = `${month}-01`;
  if (!validDate(start)) return [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const days: string[] = [];
  while (cursor.toISOString().startsWith(month)) {
    days.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
export function adjacentMonth(month: string, direction: number): string {
  const cursor = new Date(`${month}-01T12:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + direction);
  return cursor.toISOString().slice(0, 7);
}
function normalized(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim(); }
function personMatches(person: { managerId: string | null; unitId: string; name: string; employeeNumber: string }, filters: VacationCalendarFilters) {
  return (!filters.managerId || (filters.managerId === "none" ? person.managerId === null : person.managerId === filters.managerId))
    && (!filters.unitId || person.unitId === filters.unitId)
    && (!filters.query || normalized(`${person.name} ${person.employeeNumber}`).includes(normalized(filters.query)));
}
export function calendarRows(snapshot: VacationCalendarSnapshot, filters: VacationCalendarFilters) {
  const days = monthDays(filters.month);
  if (!days.length) return [];
  return snapshot.rows.filter(row => !row.archivedAt && row.startDate <= days.at(-1)! && row.endDate >= days[0]
    && personMatches({ ...row, name: row.employeeName }, filters)
    && (filters.status === "planned" ? row.status !== "cancelled" : !filters.status || row.status === filters.status))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName, "pt-BR") || a.id.localeCompare(b.id));
}
export function vacationCalendarSummary(snapshot: VacationCalendarSnapshot, filters: VacationCalendarFilters) {
  const rows = calendarRows(snapshot, filters);
  const days = monthDays(filters.month).map(date => {
    const entries = rows.filter(row => row.startDate <= date && row.endDate >= date);
    return { date, entries, approved: new Set(entries.filter(row => row.status === "approved").map(row => row.employeeId)).size, requested: new Set(entries.filter(row => row.status === "requested").map(row => row.employeeId)).size };
  });
  return {
    rows, days,
    approved: new Set(rows.filter(row => row.status === "approved").map(row => row.employeeId)).size,
    requested: new Set(rows.filter(row => row.status === "requested").map(row => row.employeeId)).size,
    peak: Math.max(0, ...days.map(day => day.approved)),
    workforce: snapshot.options.employees.filter(person => person.activeInSystem && personMatches(person, filters)).length,
  };
}
