import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LocationInterval } from "@/lib/monitoring/domain/types";
import { compactLocationTimeline, LocationTimeline } from "./location-timeline";

describe("linha do tempo explicada", () => {
  it("junta estados contíguos sem alterar a origem nem preencher lacunas", () => {
    const intervals: LocationInterval[] = [
      { area: "operation", state: "unknown", start: 0, end: 10, evidenceEventIds: [] },
      { area: "operation", state: "unknown", start: 10, end: 20, evidenceEventIds: [] },
      { area: "operation", state: "inside", start: 20, end: 30, evidenceEventIds: ["e1"] },
      { area: "operation", state: "inside", start: 30, end: 40, evidenceEventIds: ["e2"] },
      { area: "operation", state: "inside", start: 50, end: 60, evidenceEventIds: ["e3"] },
      { area: "perimeter", state: "unknown", start: 0, end: 60, evidenceEventIds: [] },
    ];
    const original = structuredClone(intervals);
    const compact = compactLocationTimeline(intervals);
    expect(compact).toHaveLength(4);
    expect(compact[1]).toMatchObject({ start: 20, end: 40, evidenceEventIds: ["e1", "e2"] });
    expect(compact[2].start).toBe(50);
    expect(intervals).toEqual(original);
  });
  it("explica mapa e cobertura somente na área correspondente", () => {
    render(<LocationTimeline intervals={[
      { area: "operation", state: "unknown", start: 0, end: 1000, evidenceEventIds: [] },
      { area: "perimeter", state: "unknown", start: 0, end: 1000, evidenceEventIds: [] },
    ]} issues={[
      { code: "INCOMPLETE_AREA_MAPPING", detail: "Mapa incompleto de entrada/saída: perimeter", eventIds: [] },
      { code: "AREA_COVERAGE_MISSING", detail: "operation", eventIds: [] },
    ]} />);
    expect(screen.getByText(/A saída do torniquete indica saída da operação/)).toBeInTheDocument();
    expect(screen.getByText(/Coleta completa desta área não confirmada/)).toBeInTheDocument();
    expect(screen.getByText("Perímetro · Desconhecido")).toBeInTheDocument();
    expect(screen.getByText("Operação · Desconhecido")).toBeInTheDocument();
  });
});
