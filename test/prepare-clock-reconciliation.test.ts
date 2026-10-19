import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { bindingSql, planBindings } from "../scripts/prepare-clock-reconciliation.mjs";

const employeeId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const cpf = "01234567890";
function fixture() {
  return {
    registry: { files: [{ sourceFile: "synthetic.txt", sha256: "a".repeat(64) }], entries: [{ conflicts: [] as string[], cpf, pis: null, employeeNumber: "123", fullName: "JOSE TESTE", identityType: "cpf", sourceFile: "synthetic.txt", sourceRow: 2 }] },
    live: { employees: [{ id: employeeId, active: true, employeeNumber: "00123", name: "José Teste", admission: "2020-02-01" }], sources: [{ id: "ponto-iso-cd-jk", kind: "afd", active: true, namespace: "clock-cpf", configuration: { timeZone: "America/Sao_Paulo" } }], bindings: [] as Array<Record<string, unknown>> },
  };
}
const existing = (overrides = {}) => ({ source_id: "ponto-iso-cd-jk", identity_type: "cpf", identity_value: cpf, employee_id: employeeId, revoked_at: null, valid_from: "2020-02-01", valid_to: null, ...overrides });

describe("plano de conciliação dos relógios", () => {
  it("vincula apenas matrícula e nome exatos e limita a vigência à admissão", () => {
    const { registry, live } = fixture();
    const result = planBindings(registry, live);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]).toMatchObject({ employeeId, identityType: "cpf", validFrom: "2020-02-01", validTo: null, sourceNamespace: "clock-cpf", sourceConfiguration: { timeZone: "America/Sao_Paulo" } });
    registry.entries[0].fullName = "JOAO TESTE";
    expect(planBindings(registry, live).bindings).toHaveLength(0);
  });
  it("recusa nome coincidente com matrícula diferente, RH duplicado e conflito cadastral", () => {
    const { registry, live } = fixture();
    registry.entries[0].employeeNumber = "999";
    expect(planBindings(registry, live).bindings).toHaveLength(0);
    registry.entries[0].employeeNumber = "123";
    live.employees.push({ ...live.employees[0], id: actorId });
    expect(planBindings(registry, live).bindings).toHaveLength(0);
    live.employees.pop(); registry.entries[0].conflicts.push("INVALID_IDENTIFIER");
    expect(planBindings(registry, live).bindings).toHaveLength(0);
  });
  it("não sobrepõe vínculo conflitante nem amplia vínculo parcial implicitamente", () => {
    const { registry, live } = fixture();
    live.bindings.push(existing({ employee_id: actorId }));
    expect(planBindings(registry, live)).toMatchObject({ bindings: [], eligibleBindings: [], skipped: [{ reason: "binding_conflict" }] });
    live.bindings[0] = existing({ valid_from: "2021-01-01" });
    expect(planBindings(registry, live).bindings).toHaveLength(0);
  });
  it("mantém vínculo já existente elegível para preencher foto pendente em nova execução", () => {
    const { registry, live } = fixture(); live.bindings.push(existing());
    const result = planBindings(registry, live);
    expect(result.bindings).toHaveLength(0);
    expect(result.eligibleBindings).toHaveLength(1);
    expect(result.skipped).toMatchObject([{ reason: "already_bound" }]);
  });
  it("preserva isolamento de namespaces e respeita fim de vigência inclusivo", () => {
    const { registry, live } = fixture();
    live.sources.push({ ...live.sources[0], id: "other-clock", namespace: "other" });
    live.bindings.push(existing({ source_id: "other-clock", employee_id: actorId }));
    expect(planBindings(registry, live).bindings).toHaveLength(1);
    live.bindings[0] = existing({ valid_to: "2020-01-31" });
    expect(planBindings(registry, live).bindings).toHaveLength(1);
    live.bindings[0] = existing({ valid_to: "2020-02-01" });
    expect(planBindings(registry, live).bindings).toHaveLength(0);
  });
  it("recusa admissão ausente e fonte desativada", () => {
    const { registry, live } = fixture();
    live.sources[0].active = false;
    expect(() => planBindings(registry, live)).toThrow("CLOCK_SOURCE_REQUIRED");
    live.sources[0].active = true; live.employees[0].admission = "";
    expect(() => planBindings(registry, live)).toThrow("ADMISSION_REQUIRED");
  });
  it("SQL executa, é idempotente e rejeita alteração do snapshot da fonte", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create schema private;
        create table perfis(id uuid,papel_usuario text,status_usuario text);
        create table colaboradores(id uuid,matricula text,nome text,ativo_no_sistema boolean,admissao date);
        create table monitoring_sources(id text,kind text,active boolean,identity_namespace text,configuration jsonb);
        create table monitoring_bindings(source_id text,identity_type text,identity_value text,employee_id uuid,revoked_at timestamptz,valid_from date,valid_to date,primary key(source_id,identity_type,identity_value));
        create function private.monitoring_binding_change_impl(action text,r jsonb) returns void language plpgsql as $$begin
          insert into monitoring_bindings values(r->>'sourceId',r->>'identityType',r->>'identityValue',(r->>'employeeId')::uuid,null,(r->>'validFrom')::date,null);
        end$$;
        insert into perfis values('${actorId}','ADMIN','APROVADO');
        insert into colaboradores values('${employeeId}','00123','José Teste',true,'2020-02-01');
        insert into monitoring_sources values('ponto-iso-cd-jk','afd',true,'clock-cpf','{"timeZone":"America/Sao_Paulo"}');`);
      const { registry, live } = fixture();
      const sql = bindingSql(planBindings(registry, live).bindings, actorId);
      await db.exec(sql); await db.exec(sql);
      expect((await db.query<{ count: number }>("select count(*)::int count from monitoring_bindings")).rows[0].count).toBe(1);
      await db.exec("update monitoring_sources set identity_namespace='changed'");
      await expect(db.exec(sql)).rejects.toThrow("SOURCE_CHANGED");
      await db.exec("rollback");
      expect((await db.query<{ count: number }>("select count(*)::int count from monitoring_bindings")).rows[0].count).toBe(1);
    } finally { await db.close(); }
  }, 30000);
});
