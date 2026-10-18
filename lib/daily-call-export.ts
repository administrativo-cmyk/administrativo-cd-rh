import { validPeriod } from "@/lib/data/daily-call-dates";
import { attendanceMeta } from "@/lib/daily-call-rules";
import type { AttendanceOrigin, Employee } from "@/lib/daily-call-types";
import { toCsv } from "@/lib/csv";

const originLabels: Record<AttendanceOrigin, string> = { punch: "Importação de ponto", automatic_absence: "Falta automática", manual: "Gestor / RH" };

export function exportDailyCall(employees: Employee[], start: string, end: string): string {
  if (!validPeriod(start, end)) throw new Error("Período inválido para exportação.");
  const rows: Array<Array<string | number>> = [["Matrícula", "Nome", "Unidade", "Gestor", "Data", "Código", "Situação", "Origem", "Observação"]];
  const first = Date.parse(`${start}T12:00:00Z`);
  const last = Date.parse(`${end}T12:00:00Z`);
  for (const employee of employees) {
    for (let time = first; time <= last; time += 86_400_000) {
      const date = new Date(time).toISOString().slice(0, 10);
      const code = employee.attendance[date];
      const origin = employee.attendanceSources?.[date];
      rows.push([employee.id, employee.name, employee.unit, employee.manager, date, code ?? "", code ? attendanceMeta[code].label : "Sem marcação", code ? originLabels[origin ?? "manual"] : "", employee.observations[date] ?? ""]);
    }
  }
  return toCsv(rows);
}
