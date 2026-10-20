import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { calculateJourney } from "@/lib/monitoring/domain/calculate";
import type { MonitoringRow } from "@/lib/monitoring/contracts";
import { MonitoringDetail } from "./monitoring-detail";

vi.mock("./employee-punch-history", () => ({ EmployeePunchHistory: () => <div>Histórico de ponto</div> }));
vi.mock("@/components/employee-avatar", () => ({ EmployeeAvatar: () => <span>Foto</span> }));
afterEach(() => vi.unstubAllGlobals());

it("preserva acesso principal bruto e indicadores operacionais sem apresentar cálculos antigos de perímetro", async () => {
  const date = "2026-10-08";
  const employeeId = "30000000-0000-4000-8000-000000000001";
  const at = (time: string) => Date.parse(`${date}T${time}:00-03:00`);
  const result = calculateJourney({
    personId: employeeId, operationalDate: date,
    observationWindow: { start: at("07:00"), end: at("18:00") }, referenceAt: at("18:00"),
    punchEvents: [
      { id: "p1", personId: employeeId, at: at("08:00"), sourceId: "rep", precision: "second", role: "start" },
      { id: "p2", personId: employeeId, at: at("12:00"), sourceId: "rep", precision: "second", role: "breakStart" },
      { id: "p3", personId: employeeId, at: at("13:00"), sourceId: "rep", precision: "second", role: "breakEnd" },
      { id: "p4", personId: employeeId, at: at("17:00"), sourceId: "rep", precision: "second", role: "end" },
    ],
    accessEvents: [], mappings: [], coverage: [],
    schedule: { id: "day", expectedStart: at("08:00"), expectedEnd: at("17:00"), pairing: "explicit", allowNoBreak: false },
    evidence: { startConfirmed: true, endConfirmed: true, startCoverageConfirmed: true },
  });
  // Old stored result: a retired card and timeline must not return during deployment.
  result.outsideCd = { ...result.outsideCd, quality: "complete", milliseconds: 111000 };
  result.betweenOperationExitAndPrincipalEntry = [{ start: at("17:00"), end: at("17:02"), exitEventId: "operation-exit", entryEventId: "principal", label: "interval-between-events" }];
  result.location.push({ area: "perimeter", state: "unknown", start: at("07:00"), end: at("18:00"), evidenceEventIds: [] });
  result.issues = [
    { code: "INCOMPLETE_AREA_MAPPING", detail: "Mapa incompleto de entrada/saída: perimeter", eventIds: [] },
    { code: "AREA_COVERAGE_MISSING", detail: "perimeter", eventIds: [] },
    { code: "AREA_COVERAGE_MISSING", detail: "operation", eventIds: [] },
  ];
  const employee: MonitoringRow = { employeeId, name: "Pessoa sintética", employeeNumber: "001", unit: "CD I", manager: null, managerId: null, date, quality: "partial", dirty: false, computedAt: null, ruleVersion: "monitoring-1.5.0", summary: null };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    results: [{ date, result, dirty: false, computedAt: `${date}T21:00:00Z`, summary: {} }],
    events: [{ id: "principal", timestamp: `${date}T07:58:00-03:00`, type: "access", device: "Entrada Principal Controle", classification: "authorized", eligible: true, conflicted: false, provenance: [{ fileId: "arquivo", line: 42, sheet: null, conflict: false }] }],
  }))));
  render(<MonitoringDetail employee={employee} start={date} end={date} canAdmin={false} onClose={vi.fn()} onReprocessed={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Fora da operação com ponto aberto" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Refeitório durante trabalho" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Fora do CD" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Linha do tempo: Perímetro")).not.toBeInTheDocument();
  expect(screen.queryByText("Intervalos entre saída da operação e entrada principal")).not.toBeInTheDocument();
  const pending = screen.getByText("Pendências e repetições (1)").closest("details")!;
  expect(within(pending).getByText(/Não há cobertura completa confirmada.*Operação/)).toBeInTheDocument();
  expect(pending).not.toHaveTextContent("Perímetro");
  expect(screen.getByText(/Entrada Principal Controle · Autorizado/)).toBeInTheDocument();
  expect(screen.getByText(/Arquivo arquivo · Linha 42/)).toBeInTheDocument();
  expect(screen.getByText(/A Entrada Principal serve somente para controle: há passagem coletiva e não há saída facial/)).toBeInTheDocument();
});
