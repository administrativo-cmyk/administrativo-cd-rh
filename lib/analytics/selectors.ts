import { buildTimeBankDashboard, buildWorkforceDashboard } from "@/lib/dashboards/selectors";
import { filterTimeBank } from "@/lib/time-bank-selectors";
import type { TimeBankEmployee, TimeBankSnapshot } from "@/lib/time-bank";
import { filterWorkforce, isOperationalInWorkforce } from "@/lib/workforce-selectors";
import { situationLabels, workforceSituations, type WorkforceEmployee } from "@/lib/workforce";
import { analysisCatalog, type AnalysisFilters, type AnalysisKind, type AnalysisSnapshot } from "./contracts";

const ordering = (a: TimeBankEmployee, b: TimeBankEmployee) => a.name.localeCompare(b.name, "pt-BR") || a.employeeNumber.localeCompare(b.employeeNumber, "pt-BR") || a.id.localeCompare(b.id);
const mapped = (filters: AnalysisFilters) => ({ ...filters, managerId: filters.managerId === "none" ? "__unassigned__" : filters.managerId, situation: "", classification: "" });
function identity(kind: AnalysisKind) {
  const item = analysisCatalog.find((entry) => entry.key === kind)!;
  return { domain: kind, title: item.title, description: item.description };
}

export function buildBankAnalysis(kind: "top-20-banco-horas" | "top-por-gestor", source: TimeBankSnapshot, filters: AnalysisFilters, queriedAt: string): AnalysisSnapshot {
  const dashboard = buildTimeBankDashboard(source, filters, queriedAt);
  const result: AnalysisSnapshot = { ...dashboard, ...identity(kind) };
  const rows = filterTimeBank(source.employees, mapped(filters));
  const known = rows.filter((row) => row.measuredMinutes !== null);
  const positive = known.filter((row) => row.measuredMinutes! > 0).sort((a, b) => b.measuredMinutes! - a.measuredMinutes! || ordering(a, b));
  const negative = known.filter((row) => row.measuredMinutes! < 0).sort((a, b) => a.measuredMinutes! - b.measuredMinutes! || ordering(a, b));
  if (kind === "top-20-banco-horas") {
    const topPositive = positive.slice(0, 20); const topNegative = negative.slice(0, 20);
    result.charts = [
      { id: "credit", title: "20 maiores créditos", description: `${topPositive.length} de ${positive.length} colaborador(es) com saldo positivo no recorte. Ordem pelo saldo medido, antes do consumo em dias G.`, format: "minutes", points: topPositive.map((row) => ({ label: `${row.name} · ${row.employeeNumber}`, value: row.measuredMinutes })) },
      { id: "debt", title: "20 maiores débitos", description: `${topNegative.length} de ${negative.length} colaborador(es) com saldo negativo no recorte. Valores preservam o sinal negativo.`, format: "minutes", points: topNegative.map((row) => ({ label: `${row.name} · ${row.employeeNumber}`, value: row.measuredMinutes })) },
    ];
    result.table = {
      columns: [{ key: "side", label: "Ranking" }, { key: "rank", label: "Posição", format: "count" }, { key: "name", label: "Colaborador" }, { key: "employeeNumber", label: "Matrícula" }, { key: "unit", label: "Unidade" }, { key: "manager", label: "Gestor" }, { key: "minutes", label: "Saldo medido", format: "minutes" }, { key: "pendingDays", label: "A compensar", format: "days" }, { key: "replacementDays", label: "A repor", format: "days" }, { key: "usedDays", label: "G usados", format: "days" }, { key: "measurementDate", label: "Data da medição" }, { key: "effectiveFrom", label: "Início do ciclo" }],
      rows: [["Crédito", topPositive], ["Débito", topNegative]].flatMap(([side, selected]) => (selected as TimeBankEmployee[]).map((row, index) => ({ employeeId: row.id, side: side as string, rank: index + 1, name: row.name, employeeNumber: row.employeeNumber, unit: row.unit, manager: row.manager ?? "Sem gestor", minutes: row.measuredMinutes, pendingDays: row.pendingCompensationDays, replacementDays: row.replacementDays, usedDays: row.usedCompensationDays, measurementDate: row.measurementDate, effectiveFrom: row.effectiveFrom }))),
    };
    result.notes.push("Os cartões consideram todo o recorte; gráficos e tabela exibem até 20 pessoas por sinal. Zero e sem extrato não entram nos rankings. A exportação mantém esse mesmo recorte de até 40 linhas.", "Empates usam nome, matrícula e identificador estável. Posição de saldo não mede desempenho individual.");
    return result;
  }
  const groups = new Map<string, TimeBankEmployee[]>();
  for (const row of rows) { const key = row.managerId ?? "none"; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const grouped = [...groups].map(([managerId, entries]) => {
    const measured = entries.filter((row) => row.measuredMinutes !== null);
    const sum = (select: (row: TimeBankEmployee) => number) => measured.length ? measured.reduce((total, row) => total + select(row), 0) : null;
    return { managerId, manager: entries[0].manager ?? "Sem gestor", total: entries.length, measured: measured.length, withoutExtract: entries.length - measured.length, coverage: measured.length / entries.length * 100,
      credit: sum((row) => Math.max(0, row.measuredMinutes!)), debt: sum((row) => Math.min(0, row.measuredMinutes!)), pendingDays: sum((row) => row.pendingCompensationDays ?? 0), replacementDays: sum((row) => row.replacementDays ?? 0), usedDays: sum((row) => row.usedCompensationDays) };
  }).sort((a, b) => (b.credit ?? -1) - (a.credit ?? -1) || a.manager.localeCompare(b.manager, "pt-BR") || a.managerId.localeCompare(b.managerId));
  const chartLabel = (row: typeof grouped[number]) => grouped.some((other) => other.manager === row.manager && other.managerId !== row.managerId) ? `${row.manager} · ${row.managerId}` : row.manager;
  result.charts = [
    { id: "credit", title: "Maiores créditos por equipe", description: "Até 20 gestores com maior crédito total. Débitos são exibidos separadamente e não reduzem estes valores.", format: "minutes", points: grouped.filter((row) => row.credit !== null).slice(0, 20).map((row) => ({ label: chartLabel(row), value: row.credit })) },
    { id: "debt", title: "Maiores débitos por equipe", description: "Até 20 gestores com maior débito total, com sinal negativo. Consulte cobertura e tamanho da equipe na tabela.", format: "minutes", points: grouped.filter((row) => row.debt !== null).sort((a, b) => a.debt! - b.debt! || a.managerId.localeCompare(b.managerId)).slice(0, 20).map((row) => ({ label: chartLabel(row), value: row.debt })) },
  ];
  result.table = {
    columns: [{ key: "manager", label: "Gestor" }, { key: "total", label: "Colaboradores", format: "count" }, { key: "measured", label: "Com extrato", format: "count" }, { key: "withoutExtract", label: "Sem extrato", format: "count" }, { key: "coverage", label: "Cobertura", format: "percent" }, { key: "credit", label: "Crédito medido", format: "minutes" }, { key: "debt", label: "Débito medido (−)", format: "minutes" }, { key: "pendingDays", label: "A compensar", format: "days" }, { key: "replacementDays", label: "A repor", format: "days" }, { key: "usedDays", label: "G usados", format: "days" }], rows: grouped,
  };
  result.notes.push("Gestores são agrupados pelo identificador, mesmo quando possuem nomes iguais. Sem gestor forma um grupo próprio. A tabela inclui todas as equipes do recorte; os gráficos mostram até 20.", "Cobertura por equipe = pessoas com extrato / pessoas filtradas da equipe. Totais não são ajustados pelo tamanho da equipe e não medem desempenho do gestor.");
  return result;
}

export function buildOutsideWorkforceAnalysis(source: WorkforceEmployee[], filters: AnalysisFilters, queriedAt: string): AnalysisSnapshot {
  const dashboard = buildWorkforceDashboard(source, filters, queriedAt);
  const all = filterWorkforce(source, mapped(filters));
  const rows = all.filter((row) => !isOperationalInWorkforce(row)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const result: AnalysisSnapshot = { ...dashboard, ...identity("afastados-e-outros") };
  result.metrics = [
    { id: "registered", label: "Cadastros no recorte", value: all.length, format: "count", description: "Todo o quadro cadastrado visível, antes de separar situações fora da Chamada." },
    { id: "outside", label: "Fora do quadro da Chamada", value: rows.length, format: "count", description: "Cadastro inativo no sistema ou situação diferente de ATIVO, FÉRIAS e NOVO_ADMITIDO." },
    { id: "outsideRate", label: "Parcela fora da Chamada", value: all.length ? rows.length / all.length * 100 : null, format: "percent", numerator: rows.length, denominator: all.length, description: "Cadastros fora da Chamada / todos os cadastros filtrados. Não é taxa de absenteísmo." },
    { id: "inactive", label: "Inativos no sistema", value: rows.filter((row) => !row.activeInSystem).length, format: "count", description: "Parte do conjunto fora da Chamada. Pode incluir diferentes situações cadastrais." },
  ];
  result.charts = [{ id: "situation", title: "Situações fora da Chamada", description: "Contagem por situação cadastral atual; não deriva de batidas, afastamentos médicos presumidos ou dias sem marcação.", format: "count", points: workforceSituations.map((situation) => ({ label: situationLabels[situation], value: rows.filter((row) => row.situation === situation).length })) }];
  result.table = { columns: [{ key: "name", label: "Colaborador" }, { key: "employeeNumber", label: "Matrícula" }, { key: "unit", label: "Unidade" }, { key: "manager", label: "Gestor" }, { key: "situation", label: "Situação" }, { key: "active", label: "Ativo no sistema" }, { key: "reason", label: "Critério de inclusão" }], rows: rows.map((row) => ({ employeeId: row.id, name: row.name, employeeNumber: row.employeeNumber, unit: row.unit, manager: row.manager ?? "Sem gestor", situation: situationLabels[row.situation], active: row.activeInSystem ? "Sim" : "Não", reason: !row.activeInSystem ? "Cadastro inativo no sistema" : "Situação fora do quadro da Chamada" })) };
  result.notes.push("Férias permanece no quadro da Chamada quando o cadastro está ativo no sistema. Esta análise inclui também desligados, aviso prévio e outras situações; não é uma lista exclusivamente de afastamento médico.");
  return result;
}
