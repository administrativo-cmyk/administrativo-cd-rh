import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmployeeSchedule } from "./employee-schedule";
import { standardPayload } from "@/lib/monitoring/schedule-standards";

const employeeId = "30000000-0000-4000-8000-000000000001";
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ employeeId, canEdit: true, version: "version-1", setting: {
    id: employeeId, validFrom: "2026-10-01", validTo: null, updatedAt: "version-1", payload: standardPayload("operational-22"),
  } }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("folgas no horário do colaborador", () => {
  it("preserva referência automática ao editar sem oferecer data manual", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ employeeId, canEdit: true, version: "version-1", setting: {
      id: employeeId, validFrom: "2026-10-01", validTo: null, updatedAt: "version-1",
      payload: { ...standardPayload("operational-22"), weeklyRest: { kind: "night-women", sundayOffAnchor: "2026-10-04" } },
    } }) });
    render(<EmployeeSchedule employeeId={employeeId} date="2026-10-23" />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar horário" }));
    expect(screen.getByText(/Domingo de referência identificado: 04\/10\/2026/)).toBeVisible();
    expect(screen.queryByLabelText(/Domingo de referência da folga alternada/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Escala feminina confirmada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.data.payload).toMatchObject({ days: [0, 1, 2, 3, 4, 5], weeklyRest: { kind: "night-women", sundayOffAnchor: "2026-10-04" }, monthlySundayOff: false });
  });

  it("orienta preenchimento no cadastro quando gênero não foi informado", async () => {
    render(<EmployeeSchedule employeeId={employeeId} date="2026-10-23" />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar horário" }));
    expect(screen.getByText(/Gênero não informado: preencha o cadastro/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Referência em conferência" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).data.payload.weeklyRest).toEqual({ kind: "night-pending" });
  });
});
