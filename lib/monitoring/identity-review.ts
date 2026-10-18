/** Suggestions aid a human review. Name equality is never an identity binding. */
export function normalizeReviewName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

export function identityReviewCandidates<T extends { id: string; name: string }>(name: string | null | undefined, employees: readonly T[]): T[] {
  const normalized = normalizeReviewName(name ?? "");
  if (!normalized || !normalized.includes(" ")) return [];
  return employees.filter((employee) => normalizeReviewName(employee.name) === normalized);
}
