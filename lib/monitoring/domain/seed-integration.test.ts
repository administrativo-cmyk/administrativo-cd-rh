import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { reprocessMonitoringSnapshot } from "../reprocess";

const employeeId = "30000000-0000-4000-8000-000000000031";
const adminId = "10000000-0000-4000-8000-000000000031";
const day = "2026-10-05";
const referenceAt = Date.parse("2026-10-08T18:00:00-03:00");
const request = { employeeId, start: day, end: day, reason: "Integração local com seed real" };
const stamp = (time: string, date = day) => `${date}T${time}:00-03:00`;
type InputSnapshot = { version: number; sources: unknown[]; events: Array<{ id: string; sourceId: string; eligible: boolean; conflicted: boolean; payload: { type: string; timestamp: string; [key: string]: unknown } }>; settings: Array<{ id: string; kind: string; target: string; payload: Record<string, unknown>; [key: string]: unknown }> };
let database: PGlite;

async function inputSnapshot(): Promise<InputSnapshot> {
  const rows = await database.query<{ value: InputSnapshot }>("select private.monitoring_input($1::uuid,$2::date,$2::date) as value", [employeeId, day]);
  return rows.rows[0].value;
}
async function addSetting(kind: string, target: string, payload: unknown) {
  await database.query("insert into public.monitoring_settings(kind,target,valid_from,payload,reason,created_by) values($1,$2,$3::date,$4::jsonb,'Evidência sintética conferida',$5::uuid)", [kind, target, day, JSON.stringify(payload), adminId]);
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `);
  const directory = path.resolve("supabase/migrations");
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) await database.exec(await readFile(path.join(directory, file), "utf8"));
  await database.query("insert into auth.users(id,email,raw_user_meta_data) values($1::uuid,encode(sha256(convert_to('00000000031','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{\"nome_completo\":\"Admin Sintético\",\"cpf_normalizado\":\"00000000031\"}')", [adminId]);
  await database.query("update public.perfis set status_usuario='APROVADO',papel_usuario='ADMIN',aprovado_em=now() where id=$1::uuid", [adminId]);
  await database.query("insert into public.colaboradores(id,matricula,nome,unidade_id,situacao,admissao) values($1::uuid,'SYNTHETIC-031','Pessoa Sintética de Integração',(select id from public.unidades where codigo='CD I'),'ATIVO','2026-01-01')", [employeeId]);
  await database.exec(`insert into public.monitoring_sources(id,kind,identity_namespace,configuration) values
    ('clock-seed','afd','clock-seed','{"sourceIdentityConfirmed":true}'),
    ('defense-seed','defense-access','defense-seed','{}');`);
  await database.query("insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by) values('clock-seed','cpf','00000000031',$1::uuid,'2026-01-01','Identidade sintética conferida',$2::uuid),('defense-seed','defense','SYNTHETIC-031',$1::uuid,'2026-01-01','Identidade sintética conferida',$2::uuid)", [employeeId, adminId]);
  const entries = [
    ...["08:16", "12:00", "13:00", "17:00"].map((time, index) => ({ type: "punch", time, key: `seed-p${index}`, sourceId: "clock-seed", device: "clock-seed" })),
    { type: "access", time: "03:00", key: "seed-a0", sourceId: "defense-seed", device: "Entrada Torniquete CD POLO JK_Porta1" },
    { type: "access", time: "11:50", key: "seed-a1", sourceId: "defense-seed", device: "  Saída   Torniquete CD POLO JK_Porta1 " },
    { type: "access", time: "13:10", key: "seed-a2", sourceId: "defense-seed", device: "Entrada Torniquete CD POLO JK_Porta1" },
  ];
  for (const entry of entries) {
    const identity = entry.type === "punch" ? { type: "cpf", value: "00000000031" } : { type: "defense", value: "SYNTHETIC-031" };
    const payload = { key: entry.key, type: entry.type, timestamp: stamp(entry.time), device: entry.device, classification: "authorized", eligible: true, identity, precisionSeconds: 1, original: entry.type === "access" ? { eventName: "desbloqueio  por rosto" } : {} };
    await database.query("insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,device,classification,eligible,payload,nsr) values($1,$2,repeat('a',64),$3,$4,$5,$6::timestamptz,$7,'authorized',true,$8::jsonb,$9)", [entry.sourceId, entry.key, entry.type, identity.type, identity.value, payload.timestamp, entry.device, JSON.stringify(payload), entry.type === "punch" ? entry.key.slice(-1).padStart(9, "0") : null]);
  }
  await addSetting("schedule", employeeId, { name: "Diurno Sintético", start: "08:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6], allowNoBreak: false, pairing: "alternating", coffeeWindows: [] });
  await addSetting("evidence", employeeId, { startConfirmed: true, endConfirmed: true, startCoverageConfirmed: true });
  await addSetting("group_snapshot", employeeId, { groups: ["Todos/CD/OPERAÇÃO"], evidence: "Histórico sintético de grupos" });
  for (const area of ["operation", "cafeteria", "perimeter"]) await addSetting("coverage", `coverage-${area}`, { area, start: stamp("00:00"), end: stamp("23:59", "2026-10-06"), sourceIds: ["defense-seed"], declaredComplete: true, evidence: "Coleta sintética completa declarada" });
}, 60_000);

afterAll(async () => { if (database) await database.close(); });

describe("migration real, seed e adaptador de apuração", () => {
  it("seed global aplica 1h de lookback, normaliza leitor e mantém perímetro não apurável", async () => {
    const input = await inputSnapshot();
    const rule = input.settings.find((setting) => setting.kind === "rule");
    expect(rule?.target).toBe("global");
    expect(rule?.payload).toMatchObject({ initialLookbackSeconds: 3600, maxJourneyHours: 18, punchRepeatSeconds: 60, accessRepeatSeconds: 10 });
    const [result] = reprocessMonitoringSnapshot(input, request, referenceAt);
    expect(result.summary.workedSeconds).toBe(464 * 60);
    expect(result.summary.outsideSeconds).toBe(20 * 60);
    expect(result.summary.unknownSeconds).toBe(214 * 60);
    expect(result.summary.outsideCdSeconds).toBeNull();
    expect(result.summary.cafeSeconds).toBeNull();
    expect(result.summary.late).toBe(true);
  });
  it("máximo de 18h do seed prevalece sobre fallback de 24h do motor", async () => {
    const input = await inputSnapshot();
    input.settings.find((setting) => setting.kind === "schedule")!.payload = { name: "Longa Sintética", start: "22:00", end: "18:00", days: [0, 1, 2, 3, 4, 5, 6], allowNoBreak: false, pairing: "alternating", coffeeWindows: [] };
    const times = [stamp("22:00"), stamp("02:00", "2026-10-06"), stamp("03:00", "2026-10-06"), stamp("18:00", "2026-10-06")];
    input.events.filter((event) => event.payload.type === "punch").forEach((event, index) => { event.payload.timestamp = times[index]; });
    const [result] = reprocessMonitoringSnapshot(input, request, referenceAt);
    expect(result.summary.workedSeconds).toBeNull();
    expect(result.result.issues.some((issue) => issue.code === "JOURNEY_EXCEEDS_MAX_SPAN")).toBe(true);
  });
  it("exclusão de operação não retira atraso do agregado SQL autorizado", async () => {
    const input = await inputSnapshot();
    input.settings.find((setting) => setting.kind === "group_snapshot")!.payload = { groups: ["Todos/CD/COZINHA JK"], evidence: "Grupo sintético confirmado" };
    const [result] = reprocessMonitoringSnapshot(input, request, referenceAt);
    expect(result.summary.quality).toBe("excluded");
    expect(result.summary.outsideSeconds).toBeNull();
    expect(result.summary.cafeteriaQuality).toBe("excluded");
    expect(result.summary.mealQuality).toBe("excluded");
    expect(result.summary.mealsWithoutRest).toBeNull();
    expect(result.summary.late).toBe(true);
    await database.query("select public.monitoring_save_result($1::jsonb)", [JSON.stringify({ ...result, reason: request.reason, actor: adminId })]);
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [adminId]);
    await database.exec("set role authenticated");
    try {
      const query = await database.query<{ value: { excluded: number; totals: { lateJourneys: number; latenessAssessedJourneys: number } } }>("select public.monitoring_query('summary',$1::jsonb) as value", [JSON.stringify({ employeeId, start: day, end: day })]);
      expect(query.rows[0].value.excluded).toBe(1);
      expect(query.rows[0].value.totals.lateJourneys).toBe(1);
      expect(query.rows[0].value.totals.latenessAssessedJourneys).toBe(1);
    } finally { await database.exec("reset role"); }
  });
  it("persiste e soma refeições na consulta autorizada, sem transformar ausência em zero", async () => {
    const input = await inputSnapshot();
    const [result] = reprocessMonitoringSnapshot(input, request, referenceAt);
    result.summary.mealsWithoutRest = 2;
    result.summary.mealQuality = "partial";
    await database.query("select public.monitoring_save_result($1::jsonb)", [JSON.stringify({ ...result, reason: request.reason, actor: adminId })]);
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [adminId]);
    await database.exec("set role authenticated");
    try {
      const query = await database.query<{value:{totals:{mealsWithoutRest:number|null}}}>("select public.monitoring_query('summary',$1::jsonb) as value",[JSON.stringify({employeeId,start:day,end:day})]);
      expect(query.rows[0].value.totals.mealsWithoutRest).toBe(2);
      const empty = await database.query<{value:{totals:{mealsWithoutRest:number|null}}}>("select public.monitoring_query('summary',$1::jsonb) as value",[JSON.stringify({employeeId,start:"2026-10-01",end:"2026-10-01"})]);
      expect(empty.rows[0].value.totals.mealsWithoutRest).toBeNull();
    } finally {await database.exec("reset role");}
  });
});
