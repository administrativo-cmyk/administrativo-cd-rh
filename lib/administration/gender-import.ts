export type EmployeeGender = "feminino" | "masculino";
export type GenderSheetRow = { row: number; employeeNumber: string; name: string; sex: string };
type Employee = { id: string; employeeNumber: string; name: string; updatedAt: string };
type Alias = { number: string; employeeId: string };
const normalizeName = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();

/** The source explicitly supplies sex. Names only corroborate record identity;
 * they never determine or predict a person's gender. */
export function planConfirmedGenderImport(rows: GenderSheetRow[], employees: Employee[], aliases: Alias[] = []) {
  const byNumber = new Map<string, Set<string>>();
  const byUnpaddedNumber = new Map<string, Set<string>>();
  const unpad = (value: string) => /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;
  for (const row of [...employees.map(employee => ({ number: employee.employeeNumber, employeeId: employee.id })), ...aliases]) {
    const ids = byNumber.get(row.number.trim()) ?? new Set<string>();
    ids.add(row.employeeId); byNumber.set(row.number.trim(), ids);
    const canonical = unpad(row.number.trim());
    const canonicalIds = byUnpaddedNumber.get(canonical) ?? new Set<string>();
    canonicalIds.add(row.employeeId); byUnpaddedNumber.set(canonical, canonicalIds);
  }
  const people = new Map(employees.map(employee => [employee.id, employee]));
  const assignments = new Map<string, { employeeId: string; employeeNumber: string; name: string; expectedUpdatedAt: string; gender: EmployeeGender; sourceRows: number[] }>();
  const rejected: Array<{ row: number; employeeNumber: string; name: string; reason: string }> = [];
  const conflicts = new Set<string>();
  for (const row of rows) {
    const sex = row.sex.trim().toUpperCase();
    // Some RH exports left-pad the numeric chapa. Compare only when unique,
    // corroborate the full name, and never rewrite stored employee numbers.
    const ids = byNumber.get(row.employeeNumber.trim()) ?? byUnpaddedNumber.get(unpad(row.employeeNumber.trim()));
    const employee = ids?.size === 1 ? people.get([...ids][0]) : undefined;
    const reason = !["F", "M"].includes(sex) ? "Sexo ausente ou inválido na planilha" : !employee ? "Matrícula sem correspondência única" : normalizeName(employee.name) !== normalizeName(row.name) ? "Nome diverge da matrícula cadastrada" : null;
    if (reason) { rejected.push({ ...row, reason }); continue; }
    const gender: EmployeeGender = sex === "F" ? "feminino" : "masculino";
    const previous = assignments.get(employee!.id);
    if (previous && previous.gender !== gender) {
      conflicts.add(employee!.id); rejected.push({ ...row, reason: "Valores conflitantes para o mesmo colaborador" }); continue;
    }
    if (previous) previous.sourceRows.push(row.row);
    else assignments.set(employee!.id, { employeeId: employee!.id, employeeNumber: employee!.employeeNumber, name: employee!.name, expectedUpdatedAt: employee!.updatedAt, gender, sourceRows: [row.row] });
  }
  for (const id of conflicts) assignments.delete(id);
  return {
    assignments: [...assignments.values()], rejected,
    blank: employees.filter(employee => !assignments.has(employee.id)).map(employee => ({ employeeId: employee.id, employeeNumber: employee.employeeNumber, name: employee.name })),
  };
}
