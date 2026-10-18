import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeasurementEditor } from "./measurement-editor";
import { parseMeasuredBalance } from "@/lib/time-bank-admin/format";
import type { BankMeasurement } from "@/lib/time-bank-admin/contracts";
const id = "bc000000-0000-4000-8000-000000000001";
const row: BankMeasurement = { id, employeeId: id, employeeName: "Pessoa sintética", employeeNumber: "0001", unit: "CD I", measurementDate: "2026-10-01", effectiveFrom: "2026-10-01", workdayHours: 8, balanceMinutes: -60, source: null, importBatchId: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", cancelledAt: null };
describe("editor de medição", () => {
  it("preserva sinal e rejeita saldo malformado sem arredondamento silencioso", () => {
    expect(parseMeasuredBalance("-08:01")).toBe(-481);
    expect(parseMeasuredBalance("+08:00")).toBe(480);
    expect(parseMeasuredBalance("00:00")).toBe(0);
    for (const invalid of ["", "8.5", "08:60", "08:00:00", "1e4", "-00:99"]) expect(parseMeasuredBalance(invalid)).toBeNull();
  });
  it("edição preserva pessoa e enviaCAS exibido com saldo emminutos", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<MeasurementEditor editor={{ mode: "save", row }} employees={[]} today="2026-10-17" onClose={vi.fn()} onSave={save} />);
    expect(screen.queryByLabelText("Colaborador")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Saldo medido/), { target: { value: "-08:01" } });
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "Conferência do saldo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar medição" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ action: "save", data: expect.objectContaining({ id, employeeId: id, expectedUpdatedAt: row.updatedAt, balanceMinutes: -481 }) }));
  });
  it("cancelamento mostra efeito e falha de versão permanece visível sem fechar", async () => {
    const close = vi.fn(); const save = vi.fn().mockRejectedValue(new Error("A medição mudou. Atualize."));
    render(<MeasurementEditor editor={{ mode: "cancel", row }} employees={[]} today="2026-10-17" onClose={close} onSave={save} />);
    expect(screen.getByText(/medição anterior/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "Cancelamento conferido" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar medição" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A medição mudou");
    expect(close).not.toHaveBeenCalled();
  });
});
