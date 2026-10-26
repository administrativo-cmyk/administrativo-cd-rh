import { describe, expect, it } from "vitest";
import { observeIncompleteWork } from "./work-observation";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";
const date = "2026-10-21", employeeId = "person";
const at = (time: string, day = date) => Date.parse(`${day}T${time}:00-03:00`);
const punch = (time: string, day = date): PunchEvent => ({ id: `p-${day}-${time}`, at: at(time, day), personId: employeeId, sourceId: "rep", precision: "minute" });
const access = (time: string, direction: "entry" | "exit" = "exit", day = date): AccessEvent => ({ id: `a-${day}-${time}`, at: at(time, day), personId: employeeId, sourceId: "defense", pointId: direction, eventClass: "face", authorized: true, identified: true });
const mappings: AccessPointMapping[] = ["entry", "exit"].map(direction => ({ id: direction, pointId: direction, portalId: "turnstile", area: "operation", direction: direction as "entry" | "exit", validated: true, eventClasses: ["face"], validFrom: "2026-10-01" }));
const input = () => ({ employeeId, date, punches: [punch("10:00")], accesses: [access("13:00"), access("17:00"), access("18:12")], mappings,
  window: { start: at("02:00"), end: at("02:00", "2026-10-22") }, schedule: { start: at("10:00"), end: at("18:20") }, referenceAt: at("12:00", "2026-10-23") });
describe("observação auxiliar de jornadas incompletas", () => {
  it("calcula entrada e saída reais sem inventar descanso ou mudar os dados", () => {
    const raw = { ...input(), punches: [punch("09:52"), punch("18:00")] }, original = structuredClone(raw);
    expect(observeIncompleteWork(raw)).toMatchObject({ workedSeconds: 8 * 3600 + 8 * 60, restSeconds: 0, basis: "clock-pair" });
    expect(raw).toEqual(original);
  });
  it("sugere a última saída válida da operação, com proveniência", () => {
    expect(observeIncompleteWork(input())).toMatchObject({ basis: "turnstile-suggestion", workedSeconds: 8 * 3600 + 12 * 60, exitSuggestion: { at: at("18:12"), eventId: "a-2026-10-21-18:12", pointId: "exit", sourceId: "defense" } });
  });
  it("não usa saída anterior se houve retorno posterior", () => expect(observeIncompleteWork({ ...input(), accesses: [...input().accesses, access("18:15", "entry")] })).toBeNull());
  it("não encerra o expediente ainda aberto com a saída de almoço", () => expect(observeIncompleteWork({ ...input(), referenceAt: at("17:30"), accesses: [access("13:00")] })).toBeNull());
  it.each(["denied", "anonymous", "manual", "unvalidated", "perimeter", "expired", "other-person"])("não usa acesso %s", kind => {
    const raw = input(); raw.accesses = [access("18:00")]; raw.mappings = structuredClone(mappings);
    if (kind === "denied") raw.accesses[0].authorized = false;
    if (kind === "anonymous") raw.accesses[0].identified = false;
    if (kind === "manual") raw.accesses[0].provenance = { sourceId: "manual", origin: "manual" };
    if (kind === "unvalidated") raw.mappings.forEach(m => m.validated = false);
    if (kind === "perimeter") raw.mappings.forEach(m => m.area = "perimeter");
    if (kind === "expired") raw.mappings.forEach(m => m.validTo = "2026-10-20");
    if (kind === "other-person") raw.accesses[0].personId = "other";
    expect(observeIncompleteWork(raw)).toBeNull();
  });
  it("respeita meia-noite na jornada noturna e exclui o próximo turno", () => {
    const raw = { ...input(), punches: [punch("22:00")], schedule: { start: at("22:00"), end: at("06:20", "2026-10-22") }, window: { start: at("14:10"), end: at("14:10", "2026-10-22") }, accesses: [access("06:18", "exit", "2026-10-22"), access("18:00", "exit", "2026-10-22")] };
    expect(observeIncompleteWork(raw)?.exitSuggestion?.at).toBe(at("06:18", "2026-10-22"));
  });
  it("não transforma uma marca de intervalo em entrada nem completa três batidas", () => {
    expect(observeIncompleteWork({ ...input(), punches: [{ ...punch("10:00"), role: "breakEnd" }] })).toBeNull();
    expect(observeIncompleteWork({ ...input(), punches: [punch("10:00"), punch("13:00"), punch("18:00")] })).toBeNull();
  });
});
