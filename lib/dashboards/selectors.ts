import { attendanceCodes, type DailyCallSnapshot } from "@/lib/daily-call-types";
import { attendanceMeta } from "@/lib/daily-call-rules";
import type { MonitoringRow, MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { classifyTimeBank } from "@/lib/time-bank-selectors";
import type { TimeBankSnapshot } from "@/lib/time-bank";
import { isOperationalInWorkforce } from "@/lib/workforce-selectors";
import { situationLabels, workforceSituations, type WorkforceEmployee } from "@/lib/workforce";
import type { DashboardDomain, DashboardFilters, DashboardFormat, DashboardMetric, DashboardSnapshot } from "./contracts";

type Person = { name: string; employeeNumber: string; unit: string; manager: string | null; managerId: string | null };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
function selected(person: Person, filters: DashboardFilters): boolean {
  return (!filters.unit || person.unit === filters.unit)
    && (!filters.managerId || (filters.managerId === "none" ? person.managerId === null : person.managerId === filters.managerId))
    && (!filters.query || [person.name, person.employeeNumber, person.manager ?? "Sem gestor", person.unit].some((value) => normalize(value).includes(normalize(filters.query))));
}
function options(people: Person[]): DashboardSnapshot["options"] {
  const managers = new Map<string, string>();
  for (const person of people) managers.set(person.managerId ?? "none", person.manager ?? "Sem gestor");
  return { units: [...new Set(people.map((person) => person.unit))].sort(), managers: [...managers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) };
}
function grouped<T>(rows: T[], key: (row: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const name = key(row); const values = groups.get(name) ?? []; values.push(row); groups.set(name, values); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
}
function metric(id: string, label: string, value: number | null, format: DashboardFormat, description: string): DashboardMetric { return { id, label, value, format, description }; }
function ratio(id: string, label: string, numerator: number, denominator: number, description: string): DashboardMetric {
  return { ...metric(id, label, denominator ? numerator / denominator * 100 : null, "percent", description), numerator, denominator };
}
function dates(start: string, end: string): string[] {
  const result: string[] = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86_400_000) result.push(new Date(day).toISOString().slice(0, 10));
  return result;
}
const titles: Record<DashboardDomain, [string, string, string]> = {
  monitoramento: ["Dashboard de Monitoramento", "Tempos e qualidade das apurações de ponto e acessos.", "/monitoramento"],
  "chamada-diaria": ["Dashboard da Chamada Diária", "Marcações registradas e dias sem lançamento no quadro operacional.", "/chamada-diaria"],
  "banco-de-horas": ["Dashboard do Banco de Horas", "Saldos medidos e dias disponíveis na data consultada.", "/banco-de-horas"],
  "quadro-atual": ["Dashboard do Quadro Atual", "Distribuição e completude dos cadastros visíveis.", "/quadro-atual"],
};
function base(domain: DashboardDomain, filters: DashboardFilters, queriedAt: string, sourceOptions: DashboardSnapshot["options"]): DashboardSnapshot {
  const [title, description, operationHref] = titles[domain];
  return { domain, title, description, operationHref, queriedAt, start: filters.start, end: filters.end, options: sourceOptions, metrics: [], charts: [], table: { columns: [], rows: [] }, notes: ["Todos os números respeitam o perfil autenticado e os filtros selecionados."] };
}

export function buildWorkforceDashboard(source: WorkforceEmployee[], filters: DashboardFilters, queriedAt: string): DashboardSnapshot {
  const rows = source.filter((row) => selected(row, filters));
  const result = base("quadro-atual", filters, queriedAt, options(source));
  const operational = rows.filter(isOperationalInWorkforce).length;
  const withManager = rows.filter((row) => row.managerId !== null).length;
  result.metrics = [
    metric("registered", "Cadastros no escopo", rows.length, "count", "Todos os cadastros visíveis, incluindo situações fora da chamada."),
    metric("operational", "Quadro da Chamada", operational, "count", "Ativo no sistema e em ATIVO, FÉRIAS ou NOVO_ADMITIDO. Não representa presença."),
    metric("outsideCall", "Fora do quadro da Chamada", rows.length - operational, "count", "Outras situações ou cadastro inativo no sistema."),
    metric("withoutManager", "Sem gestor", rows.length - withManager, "count", "Cadastros com gestor não atribuído."),
    metric("unknownAdmission", "Admissão não informada", rows.filter((row) => !row.admissionDate).length, "count", "Falta de dado cadastral; não é admissão recente."),
    ratio("managerCoverage", "Cadastros com gestor", withManager, rows.length, "Cadastros com gestor dividido por todos os cadastros filtrados."),
  ];
  result.charts = [
    { id: "situations", title: "Situação cadastral", description: "Distribuição do cadastro atual; não indica presença no dia.", format: "count", points: workforceSituations.map((situation) => ({ label: situationLabels[situation], value: rows.filter((row) => row.situation === situation).length })) },
    { id: "units", title: "Cadastros por unidade", description: "Cada colaborador é contado uma vez na unidade atual.", format: "count", points: grouped(rows, (row) => row.unit).map(([label, entries]) => ({ label, value: entries.length })) },
  ];
  result.table = {
    columns: [{ key: "manager", label: "Gestor" }, { key: "total", label: "Cadastros", format: "count" }, { key: "operational", label: "Quadro da Chamada", format: "count" }, { key: "inactive", label: "Inativos no sistema", format: "count" }, { key: "missingAdmission", label: "Sem admissão", format: "count" }],
    rows: grouped(rows, (row) => row.managerId ?? "none").map(([, entries]) => ({ manager: entries[0].manager ?? "Sem gestor", total: entries.length, operational: entries.filter(isOperationalInWorkforce).length, inactive: entries.filter((row) => !row.activeInSystem).length, missingAdmission: entries.filter((row) => !row.admissionDate).length })),
  };
  result.notes.push("Fonte: cadastro atual de colaboradores, unidades e gestores. Não existe série histórica de lotação neste painel.", "Férias e demais situações refletem o cadastro atual, sem inferência a partir de batidas.");
  return result;
}

export function buildTimeBankDashboard(source: TimeBankSnapshot, filters: DashboardFilters, queriedAt: string): DashboardSnapshot {
  const rows = source.employees.filter((row) => selected(row, filters));
  const measured = rows.filter((row) => row.measuredMinutes !== null);
  const sum = (select: (row: typeof rows[number]) => number) => measured.length ? measured.reduce((total, row) => total + select(row), 0) : null;
  const result = base("banco-de-horas", { ...filters, start: source.asOfDate, end: source.asOfDate }, queriedAt, options(source.employees));
  result.metrics = [
    metric("employees", "Colaboradores no escopo", rows.length, "count", "Quadro cadastrado completo permitido ao perfil."),
    metric("withExtract", "Com extrato vigente", measured.length, "count", "Medição aplicável à data de consulta."),
    metric("withoutExtract", "Sem extrato", rows.length - measured.length, "count", "Sem medição aplicável; não entra como saldo zero."),
    ratio("extractCoverage", "Cobertura de extratos", measured.length, rows.length, "Colaboradores com extrato dividido pelos colaboradores filtrados."),
    metric("positiveMinutes", "Crédito medido", sum((row) => Math.max(0, row.measuredMinutes!)), "minutes", "Soma dos minutos positivos dos extratos vigentes, antes do consumo em dias G."),
    metric("negativeMinutes", "Débito medido", sum((row) => Math.max(0, -row.measuredMinutes!)), "minutes", "Magnitude dos minutos negativos dos extratos vigentes."),
    metric("pendingDays", "Dias a compensar", sum((row) => row.pendingCompensationDays ?? 0), "days", "Dias restantes calculados pelo ciclo vigente, após os G registrados."),
    metric("replacementDays", "Dias a repor", sum((row) => row.replacementDays ?? 0), "days", "Dias de reposição calculados pelo ciclo vigente."),
  ];
  result.charts = [
    { id: "classification", title: "Classificação do saldo medido", description: "Sinal dos minutos medidos. Sem extrato permanece separado.", format: "count", points: ([["POSITIVO", "Positivo"], ["ZERO", "Zero"], ["NEGATIVO", "Negativo"], ["SEM_EXTRATO", "Sem extrato"]] as const).map(([code, label]) => ({ label, value: rows.filter((row) => classifyTimeBank(row) === code).length })) },
    { id: "pendingByUnit", title: "Dias a compensar por unidade", description: "Soma dos dias do ciclo; unidade sem extrato não recebe zero fictício.", format: "days", points: grouped(rows, (row) => row.unit).map(([label, entries]) => ({ label, value: entries.some((row) => row.measuredMinutes !== null) ? entries.reduce((total, row) => total + (row.pendingCompensationDays ?? 0), 0) : null })) },
  ];
  result.table = {
    columns: [{ key: "manager", label: "Gestor" }, { key: "total", label: "Colaboradores", format: "count" }, { key: "measured", label: "Com extrato", format: "count" }, { key: "positiveMinutes", label: "Crédito medido", format: "minutes" }, { key: "negativeMinutes", label: "Débito medido", format: "minutes" }, { key: "pendingDays", label: "A compensar", format: "days" }, { key: "usedDays", label: "Dias G usados", format: "days" }],
    rows: grouped(rows, (row) => row.managerId ?? "none").map(([, entries]) => {
      const known = entries.filter((row) => row.measuredMinutes !== null);
      return { manager: entries[0].manager ?? "Sem gestor", total: entries.length, measured: known.length,
        positiveMinutes: known.length ? known.reduce((total, row) => total + Math.max(0, row.measuredMinutes!), 0) : null,
        negativeMinutes: known.length ? known.reduce((total, row) => total + Math.max(0, -row.measuredMinutes!), 0) : null,
        pendingDays: known.length ? known.reduce((total, row) => total + (row.pendingCompensationDays ?? 0), 0) : null,
        usedDays: known.length ? known.reduce((total, row) => total + row.usedCompensationDays, 0) : null };
    }),
  };
  result.notes.push("Fonte: medição vigente do Banco de Horas e compensações G do respectivo ciclo.", "Minutos medidos e dias restantes têm bases diferentes. G consome dias pela regra existente; o painel não calcula um saldo líquido fictício em horas.", "A data consulta o saldo vigente daquele dia, usando a lotação cadastral atual. Não reconstitui o histórico de gestores ou unidades.");
  return result;
}

export function buildDailyCallDashboard(source: DailyCallSnapshot, workforce: WorkforceEmployee[], filters: DashboardFilters, queriedAt: string): DashboardSnapshot {
  const employees = new Map(workforce.map((row) => [row.id, row]));
  const available = source.employees.map((row) => {
    const person = employees.get(row.databaseId ?? "");
    if (!person) throw new Error("DASHBOARD_SOURCE_CHANGED");
    return { ...row, person };
  });
  const rows = available.filter((row) => selected(row.person, filters) && (!row.admissionDate || row.admissionDate <= filters.end));
  const result = base("chamada-diaria", filters, queriedAt, options(available.map((row) => row.person)));
  const dayRows = (day: string) => rows.filter((row) => !row.admissionDate || row.admissionDate <= day);
  const marked = rows.filter((row) => row.attendance[filters.end] !== undefined).length;
  const count = (code: string) => rows.filter((row) => row.attendance[filters.end] === code).length;
  result.metrics = [
    metric("employees", "Quadro da Chamada", rows.length, "count", `Cadastros operacionais atuais admitidos até ${filters.end}, incluindo admissão ainda não informada.`),
    metric("marked", "Com marcação", marked, "count", `Qualquer status efetivamente registrado em ${filters.end}.`),
    metric("unmarked", "Sem marcação", rows.length - marked, "count", "Ausência de lançamento não significa falta ou ausência ao trabalho."),
    metric("present", "Presentes registrados", count("P"), "count", "Somente código P, manual ou importado com evidência."),
    metric("unjustified", "Faltas injustificadas registradas", count("I"), "count", "Somente código I efetivamente salvo; férias, folgas e atestados ficam separados."),
    ratio("fillRate", "Preenchimento da Chamada", marked, rows.length, "Marcações registradas dividido pelo quadro filtrado na data final. Não é taxa de presença."),
  ];
  result.charts = [
    { id: "status", title: `Marcações em ${filters.end}`, description: "Distribuição dos códigos salvos, com sem marcação separado.", format: "count", points: [...attendanceCodes.map((code) => ({ label: attendanceMeta[code].label, value: count(code) })), { label: "Sem marcação", value: rows.length - marked }] },
    { id: "dailyMarks", title: "Marcações registradas por dia", description: "Histórico dos lançamentos das pessoas no recorte cadastral atual; não mede presença esperada.", format: "count", points: dates(filters.start, filters.end).map((label) => ({ label, value: dayRows(label).filter((row) => row.attendance[label] !== undefined).length })) },
  ];
  result.table = {
    columns: [{ key: "date", label: "Data" }, { key: "registered", label: "Marcações", format: "count" }, { key: "present", label: "Presente (P)", format: "count" }, { key: "unjustified", label: "Injustificada (I)", format: "count" }, { key: "unmarked", label: "Sem marcação", format: "count" }, { key: "punch", label: "Origem ponto", format: "count" }, { key: "automaticAbsence", label: "Falta automática", format: "count" }, { key: "manual", label: "Manual", format: "count" }],
    rows: dates(filters.start, filters.end).map((date) => {
      const daily = dayRows(date); const filled = daily.filter((row) => row.attendance[date] !== undefined);
      return { date, registered: filled.length, present: daily.filter((row) => row.attendance[date] === "P").length, unjustified: daily.filter((row) => row.attendance[date] === "I").length, unmarked: daily.length - filled.length,
        punch: filled.filter((row) => row.attendanceSources?.[date] === "punch").length, automaticAbsence: filled.filter((row) => row.attendanceSources?.[date] === "automatic_absence").length, manual: filled.filter((row) => (row.attendanceSources?.[date] ?? "manual") === "manual").length, schedule: filled.filter((row) => row.attendanceSources?.[date] === "schedule").length };
    }),
  };
  result.notes.push(`Os cartões usam a data final (${filters.end}); gráfico e tabela mostram o período informado.`, "Fonte: lançamentos persistidos da Chamada. Não se preenche falta a partir de campo vazio, relógio sem cobertura ou escala desconhecida.", "O recorte usa o quadro operacional e a lotação atuais. Dias anteriores à admissão conhecida são excluídos; não é uma reconstrução histórica do quadro.");
  const unknownAdmission = rows.filter((row) => !row.admissionDate).length;
  result.table.columns.push({ key: "schedule", label: "Folga da escala", format: "count" });
  result.notes.push("Folgas fixas confirmadas são preenchidas pela escala e identificadas separadamente dos lançamentos manuais.");
  if (unknownAdmission) result.notes.push(`${unknownAdmission} cadastro(s) sem admissão informada permanecem identificados no total; a elegibilidade histórica não está comprovada.`);
  return result;
}

function numeric(row: MonitoringRow, key: string): number | null {
  const value = row.summary?.[key];
  return row.dirty || row.quality === "stale" || typeof value !== "number" || !Number.isFinite(value) ? null : value;
}
function totalSeconds(rows: MonitoringRow[], key: string): number | null {
  const values = rows.map((row) => key === "unknownSeconds" && numeric(row, "workedSeconds") === null ? null : numeric(row, key)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
const asMinutes = (seconds: number | null) => seconds === null ? null : seconds / 60;
export function buildMonitoringDashboard(source: MonitoringSnapshot, filters: DashboardFilters, queriedAt: string): DashboardSnapshot {
  if (source.rows.length !== source.total) throw new Error("DASHBOARD_INCOMPLETE_MONITORING");
  const rows = source.rows.filter((row) => selected(row, filters));
  const knownLate = rows.filter((row) => !row.dirty && row.quality !== "stale" && typeof row.summary?.late === "boolean");
  const late = knownLate.filter((row) => row.summary?.late === true).length;
  const assessed = rows.filter((row) => row.date !== null);
  const complete = assessed.filter((row) => row.quality === "complete").length;
  const availableOptions = source.options ? { units: source.options.units, managers: [...source.options.managers] } : options(source.rows);
  if (source.rows.some((row) => row.managerId === null) && !availableOptions.managers.some((row) => row.id === "none")) availableOptions.managers.push({ id: "none", name: "Sem gestor" });
  const result = base("monitoramento", filters, queriedAt, availableOptions);
  result.datasetVersion = source.datasetVersion;
  result.metrics = [
    metric("people", "Colaboradores no escopo", new Set(rows.map((row) => row.employeeId)).size, "count", "Pessoas distintas no recorte autorizado."),
    metric("journeys", "Resultados de jornadas", assessed.length, "count", "Datas com resultado persistido; não representa todas as jornadas esperadas."),
    metric("withoutResult", "Pessoas sem resultado", rows.filter((row) => row.date === null).length, "count", "Sem resultado no período; não são tratadas como tempo zero ou ausência."),
    metric("workedMinutes", "Trabalho apurado", asMinutes(totalSeconds(rows, "workedSeconds")), "minutes", "Soma dos períodos de trabalho conhecidos, com descanso oficial excluído e resultados desatualizados fora da soma."),
    metric("outsideMinutes", "Fora da operação", asMinutes(totalSeconds(rows, "outsideSeconds")), "minutes", "Tempo conhecido durante trabalho. Valores parciais não estimam períodos sem cobertura."),
    metric("cafeteriaMinutes", "Refeitório durante trabalho", asMinutes(totalSeconds(rows, "cafeteriaSeconds")), "minutes", "Tempo apurado no refeitório dentro dos períodos de trabalho elegíveis."),
    ratio("lateRate", "Jornadas com atraso > 15 min", late, knownLate.length, "Numerador: atraso estritamente maior que 900 segundos. Denominador: jornadas com atraso apurável e resultado atual, inclusive quando outro indicador foi excluído."),
    ratio("completeResults", "Resultados completos", complete, assessed.length, "Resultados completos dividido pelas datas com resultado persistido. Pessoas sem resultado aparecem separadamente."),
  ];
  const qualities: Array<[string, string]> = [["complete", "Completo"], ["partial", "Parcial"], ["unavailable", "Indisponível"], ["excluded", "Excluído"], ["stale", "Recalcular"]];
  result.charts = [
    { id: "quality", title: "Qualidade dos resultados", description: "Datas com resultado persistido. Pessoas sem resultado aparecem no cartão separado; não é cobertura da população esperada.", format: "count", points: qualities.map(([quality, label]) => ({ label, value: assessed.filter((row) => row.quality === quality).length })) },
    { id: "outsideByDate", title: "Fora da operação por dia", description: "Soma do tempo conhecido. Sem medida recebe valor indisponível, nunca zero fictício.", format: "minutes", points: dates(filters.start, filters.end).map((label) => ({ label, value: asMinutes(totalSeconds(rows.filter((row) => row.date === label), "outsideSeconds")) })) },
  ];
  result.table = {
    columns: [{ key: "date", label: "Data operacional" }, { key: "results", label: "Resultados", format: "count" }, { key: "workedMinutes", label: "Trabalho", format: "minutes" }, { key: "outsideMinutes", label: "Fora operação", format: "minutes" }, { key: "cafeteriaMinutes", label: "Refeitório", format: "minutes" }, { key: "unknownMinutes", label: "Estado desconhecido", format: "minutes" }, { key: "late", label: "Atraso >15 min", format: "count" }, { key: "lateEligible", label: "Atraso apurável", format: "count" }],
    rows: dates(filters.start, filters.end).map((date) => {
      const daily = rows.filter((row) => row.date === date); const eligible = knownLate.filter((row) => row.date === date);
      return { date, results: daily.length, workedMinutes: asMinutes(totalSeconds(daily, "workedSeconds")), outsideMinutes: asMinutes(totalSeconds(daily, "outsideSeconds")), cafeteriaMinutes: asMinutes(totalSeconds(daily, "cafeteriaSeconds")), unknownMinutes: asMinutes(totalSeconds(daily, "unknownSeconds")), late: eligible.length ? eligible.filter((row) => row.summary?.late === true).length : null, lateEligible: eligible.length };
    }),
  };
  result.notes.push("Fonte: resultados persistidos do motor temporal. Todas as páginas do recorte são verificadas antes da agregação.", "Entrada Principal é somente um registro de controle. Não calcula tempo fora do CD nem interfere nos indicadores de operação e refeitório.", "Indicadores têm elegibilidade própria. Exclusão de uma área não exclui automaticamente o atraso.", "Tempos de áreas diferentes podem se sobrepor. Não some refeitório e fora da operação como se fossem intervalos distintos.", "Sem cobertura, sem vínculo ou resultado desatualizado permanece indisponível. Não há estimativa de produtividade nem inferência de falta neste painel.");
  return result;
}
