import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringAdmin } from "./monitoring-admin";
import type { AdminSnapshot } from "./admin-types";

const admin: AdminSnapshot = {
  sources: [{ id: "defense-person-test", kind: "defense-person", timezone: "America/Sao_Paulo", heartbeat_at: null, worker_state: "idle", last_success_at: null }],
  files: [], settings: [], bindings: [], users: [], audit: [],
  employees: [{ id: "30000000-0000-4000-8000-000000000001", name: "Ana Sintética", employeeNumber: "FICT-001" }, { id: "30000000-0000-4000-8000-000000000002", name: "ANA SINTETICA", employeeNumber: "FICT-002" }],
  pending: [{ source_id: "defense-person-test", identity_type: "defense", identity_value: "000123", name: "Ana Sintética" }],
  people: [{ source_id: "defense-person-test", external_id: "000123", name: "Ana Sintética", groups: [], photo_reference: "photo.jpg", has_photo: true, linked: false }],
};
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => admin })));
describe("conferência explícita de identidade", () => {
  it("mostra foto antes de vincular e homônimos sem escolher ou salvar automaticamente", async () => {
    const user = userEvent.setup();
    render(<MonitoringAdmin section="reconcile" today="2026-10-17" />);
    await user.click(await screen.findByRole("button", { name: "Conferir cadastro" }));
    expect(screen.getByText("Homônimos no RH — confira a matrícula")).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Conferência da identidade" });
    expect(within(review).getByRole("img")).toHaveAttribute("src", expect.stringContaining("identityValue=000123"));
    expect(screen.getByLabelText("Colaborador RH")).toHaveValue("");
    expect(screen.getByLabelText("Evidência do vínculo")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Escolher matrícula FICT-002 para conferir" }));
    expect(screen.getByLabelText("Colaborador RH")).toHaveValue(admin.employees[1].id);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    await user.type(screen.getByLabelText("Evidência do vínculo"), "Documento sintético conferido");
    fireEvent.change(screen.getByLabelText("Identificador completo"), { target: { value: "000124" } });
    expect(screen.getByLabelText("Colaborador RH")).toHaveValue("");
    expect(screen.getByLabelText("Evidência do vínculo")).toHaveValue("");
  });
  it("atualizar administração recupera a foto após falha", async () => {
    const user = userEvent.setup();
    render(<MonitoringAdmin section="reconcile" today="2026-10-17" />);
    const image = await screen.findByRole("img", { name: "Foto de Ana Sintética" });
    fireEvent.error(image);
    expect(screen.queryByRole("img", { name: "Foto de Ana Sintética" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atualizar administração" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Foto de Ana Sintética" })).toBeInTheDocument());
  });
});
