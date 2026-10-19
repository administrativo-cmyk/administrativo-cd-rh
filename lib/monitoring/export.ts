import type { MonitoringRow } from './contracts';
export function safeCsvCell(value:unknown){
 const text=value===null||value===undefined?'Não apurável':String(value);
 const safe=/^[\s\u0000-\u001f]*[=+@-]/.test(text)?`'${text}`:text;
 return `"${safe.replaceAll('"','""')}"`;
}
export function monitoringCsv(rows:MonitoringRow[],metadata:Record<string,unknown>){
 const lines:unknown[][]=[['Monitoramento CD','America/Sao_Paulo'],...Object.entries(metadata),['Colaborador','Matrícula','Unidade','Gestor','Data operacional','Qualidade','Trabalhado (s)','Descanso excluído (s)','Fora operação (s)','Refeitório em W (s)','Refeições sem descanso','Qualidade das refeições','Café em W (s)','Fora CD (s)','Desconhecido operação (s)','Atraso (s)','Maior que 15 min','Regra','Exclusões','Cobertura operação','Escala','Grupos']];
 for(const r of rows){const s=r.summary??{};lines.push([r.name,r.employeeNumber,r.unit,r.manager,r.date,r.quality,...['workedSeconds','restSeconds','outsideSeconds','cafeteriaSeconds','mealsWithoutRest','mealQuality','cafeSeconds','outsideCdSeconds','unknownSeconds','lateSeconds','late'].map(k=>s[k]),r.ruleVersion,JSON.stringify(s.exclusions??[]),s.coverageRatio,s.scheduleName,JSON.stringify(s.groups??[])]);}
 return '\uFEFF'+lines.map(row=>row.map(safeCsvCell).join(';')).join('\r\n');
}
