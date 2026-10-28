import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DailyCallExcelButton } from "./daily-call-excel-button";
import { initialEmployees } from "@/lib/mock-daily-call";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/daily-call-excel", () => ({ downloadDailyCallExcel: download }));
const input = { employees: initialEmployees.slice(0, 2), start: "2026-10-01", end: "2026-10-31" };
afterEach(() => download.mockReset());

it("exporta o período filtrado com progresso e permite cancelar", async () => {
  download.mockImplementation(async (_, options) => {
    options.onProgress(1, 2);
    await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Cancelado", "AbortError"))));
  });
  render(<DailyCallExcelButton input={input} disabled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
  expect(await screen.findByRole("status")).toHaveTextContent("1 de 2");
  expect(download).toHaveBeenCalledWith(input, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancelar exportação" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("informa falha e libera nova tentativa", async () => {
  download.mockRejectedValue(new Error("Falha nas batidas. Tente novamente."));
  render(<DailyCallExcelButton input={input} disabled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha nas batidas");
  expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeEnabled();
});
