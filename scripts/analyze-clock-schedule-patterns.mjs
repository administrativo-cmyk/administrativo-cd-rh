import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { inferObservedSchedules } from "../lib/monitoring/schedule-inference.ts";

const inputPath = resolve("artifacts/clock-reconciliation/clock-patterns-input.json");
const bytes = await readFile(inputPath);
const input = JSON.parse(bytes.toString("utf8"));
const completeFrom = "2026-10-01T00:00:00-03:00";
const completeToExclusive = "2026-10-13T00:00:00-03:00";
const patterns = inferObservedSchedules(input.punches, completeFrom, completeToExclusive);
const metadata = new Map(JSON.parse(await readFile(resolve("artifacts/clock-reconciliation/employee-schedule-metadata.json"),"utf8")).map(row => [row.id,row]));
const { selectDefaultSchedule } = await import("../lib/monitoring/select-default-schedule.ts");
const byEmployee = new Map(patterns.map(pattern => [pattern.employeeId, pattern]));
const rows = input.employees.map(employee => { const pattern = byEmployee.get(employee.id) ?? null; const details=metadata.get(employee.id); return { ...employee,...details, pattern, defaultSchedule:selectDefaultSchedule(details ?? {role:null,department:null},pattern) }; });
const output = resolve("relogio de ponto/ESCALAS_PELO_PONTO_2026-10-19");
await mkdir(output, { recursive: true });
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const labels = { recurring: "HORÁRIO RECORRENTE", variable: "HORÁRIO VARIÁVEL", insufficient: "AMOSTRA INSUFICIENTE" };
const cadences = { possible_12x36: "Alternância de 48h observada: possível 12x36, conferir", near_daily: "Presença quase diária observada, ciclo de folgas não confirmado", irregular: "Intervalos entre dias variáveis", insufficient: "Sem padrão suficiente para ciclo" };
const cell = value => { const text = String(value ?? ""); return `"${(/^[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; };
const header = ["Matrícula", "Nome completo", "Unidade", "Gestor", "Situação RH", "Classificação", "Entrada estimada", "Saída estimada", "Noturna", "Dias utilizáveis", "Dias no padrão", "Aderência", "Sequências utilizáveis / dias com ponto", "Ritmo observado (conferir ciclo)", "Dias observados da semana (não é escala semanal)", "Dispersão entrada (min)", "Dispersão saída (min)", "Datas no padrão", "Dias excluídos", "Ação necessária"];
const csv = list => "\ufeff" + [header, ...list.map(({ employeeNumber, name, unit, manager, status, pattern: p }) => [employeeNumber, name, unit, manager, status,
  p ? labels[p.status] : "SEM BATIDAS UTILIZÁVEIS", p?.start, p?.end, p?.overnight === null || !p ? "" : p.overnight ? "Sim" : "Não", p?.daysObserved ?? 0, p?.matchingDays ?? 0,
  p ? `${Math.round(p.matchingRatio * 100)}%` : "", p ? `${Math.round(p.usableDayRatio * 100)}%` : "", p ? cadences[p.observedCadence] : "", p?.observedWeekdays.map(day => weekdays[day]).join(", "), p?.startSpreadMinutes, p?.endSpreadMinutes,
  p?.matchingDates.join(", "), p?.excludedDays.map(day => `${day.date}: ${day.reason}`).join(" | "),
  p?.status === "recurring" ? "Conferir horário estimado e definir ciclo/dias de trabalho e folga antes de ativar escala" : "Conferir sequência e obter mais dias completos antes de definir escala",
  ])].map(row => row.map(cell).join(";")).join("\r\n") + "\r\n";
for (const [file, selected] of [
  ["TODOS_OS_COLABORADORES.csv", rows],
  ["HORARIOS_RECORRENTES.csv", rows.filter(row => row.pattern?.status === "recurring")],
  ["HORARIOS_VARIAVEIS.csv", rows.filter(row => row.pattern?.status === "variable")],
  ["AMOSTRA_INSUFICIENTE_OU_SEM_PONTO.csv", rows.filter(row => !row.pattern || row.pattern.status === "insufficient")],
]) await writeFile(join(output, file), csv(selected));
const grouped = new Map();
for (const row of rows.filter(row => row.pattern?.status === "recurring")) { const key = `${row.pattern.start}-${row.pattern.end}`; grouped.set(key, (grouped.get(key) ?? 0) + 1); }
const summary = {
  checkedAt: new Date().toISOString(), sourceCheckedAt: input.checkedAt,
  inputSha256: createHash("sha256").update(bytes).digest("hex"), completeFrom, completeToExclusive,
  partialDateExcluded: "2026-10-13", employees: rows.length, linkedPunches: input.punches.length,
  recurring: rows.filter(row => row.pattern?.status === "recurring").length,
  variable: rows.filter(row => row.pattern?.status === "variable").length,
  insufficient: rows.filter(row => row.pattern?.status === "insufficient").length,
  noUsablePunches: rows.filter(row => !row.pattern).length,
  possible12x36: rows.filter(row => row.pattern?.observedCadence === "possible_12x36").length,
  recurringHours: [...grouped.entries()].map(([hours, people]) => ({ hours, people })).sort((a, b) => b.people - a.people),
  selectedDefaults: rows.filter(r=>r.defaultSchedule.state==="selected").length,
  selectedActiveDefaults: rows.filter(r=>r.active&&["ATIVO","NOVO_ADMITIDO"].includes(r.status)&&r.defaultSchedule.state==="selected").length,
  weeklyRosterConfirmed: false, officialRosterApplicationAllowed: false,
};
await writeFile(join(output,"HORARIOS_PADRAO_PARA_CADASTRO.csv"), "\ufeff" + [["Matrícula","Nome","Função","Setor","Resultado","Horário padrão","Entrada","Saída","Almoço (min)","Ciclo confirmado","Plantão referência","Evidência"],...rows.map(r=>[r.employeeNumber,r.name,r.role,r.department,r.defaultSchedule.state,r.defaultSchedule.payload?.name,r.defaultSchedule.payload?.start,r.defaultSchedule.payload?.end,r.defaultSchedule.payload?.lunchMinutes,r.defaultSchedule.payload?.weeklyRosterConfirmed,r.defaultSchedule.payload?.cycle?.anchorDate,r.defaultSchedule.reason])].map(row=>row.map(cell).join(";")).join("\r\n"));
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
await writeFile(join(output, "evidencias-por-colaborador.json"), JSON.stringify(rows, null, 2));
await writeFile(join(output, "LEIA-ME.txt"), `HORÁRIOS RECORRENTES OBSERVADOS NO PONTO\n\nPeríodo completo informado pelo usuário: 01/10 a 12/10/2026. Dia 13/10 é parcial e foi excluído da inferência; 30/09 também não integra o período declarado completo.\n\nCada linha representa um colaborador do RH, vinculado por matrícula e nome aos relógios CPF/PIS. Os eventos originais permanecem preservados. Janelas que cruzam o limite do período completo, sequências ímpares, repetições próximas ou simultâneas e durações incompatíveis são excluídas da análise. O corte entre dias é escolhido por pessoa para reconhecer jornadas noturnas.\n\nHorário recorrente exige pelo menos 5 jornadas utilizáveis, aderência mínima de 80%, sequências utilizáveis em pelo menos 75% dos dias observados e observações com intervalo de pelo menos 7 dias. Estimativas usam mediana e arredondamento a 15 minutos. Tolerância analítica: entrada 30 min; saída 45 min. Dispersões e datas utilizadas constam no CSV e nas evidências JSON. Duas batidas podem indicar horário observado, mas não autorizam jornada sem intervalo nem comprovam fechamento.\n\nHORÁRIO OBSERVADO NÃO DEFINE FOLGA OU ESCALA SEMANAL. O período tem 12 dias e não contém duas ocorrências de todos os dias da semana. A lista de dias observados é evidência de presença, não prova de que os demais dias sejam folga ou falta. Os horários recorrentes podem ser registrados como janelas estimadas, com ciclo de folgas pendente. Essa janela organiza as batidas; não autoriza atraso, falta automática nem jornada confirmada.\n\n${summary.recurring} colaboradores com horário recorrente; ${summary.variable} com horários variáveis; ${summary.insufficient} com amostra insuficiente; ${summary.noUsablePunches} sem batidas utilizáveis. Todos os ${summary.employees} colaboradores estão listados.\n\nOs arquivos contêm dados pessoais. Permanecem na pasta local ignorada pelo Git. A publicação inclui somente o código e os testes, sem as listas ou as batidas.\n`);
console.log(JSON.stringify({ ...summary, recurringHours: summary.recurringHours.slice(0, 8) }, null, 2));

await writeFile(join(output,"LEIA-ME-PADROES.txt"),"Padrões fornecidos pelo usuário em 19/10/2026. Todos têm 60 minutos de almoço. Classificação usa função e setor existentes. Seleção exige ao menos 3 jornadas completas próximas do padrão e maioria de pelo menos 50%; empates ficam em revisão. Entrada tolerada 30min e saída 60min são limites da seleção analítica, não tolerância de atraso. Administrativo: seg-sex; manutenção: seg-sáb. APP usa ciclo 12x36 apenas com pelo menos 4 plantões da mesma paridade, distribuídos por 6 dias ou mais. Jovens e menores: seg-sex. Diurno: seg-sáb, folga domingo. Noturno: domingo a sexta, folga sábado e um domingo mensal cuja data deve ser informada; domingos sem data definida permanecem pendentes para falta automática. Horários diferentes e amostra insuficiente ficam para conferência do encarregado. 13/10 parcial excluído. O CSV de padrões prevalece sobre as medianas estimadas do relatório anterior. Sem alteração do Banco de Horas por esta seleção.\n");
