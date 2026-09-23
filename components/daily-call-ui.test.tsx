import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmployeeDrawer } from "./employee-drawer";
import { ViewModeSelector } from "./view-mode-selector";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initialEmployees } from "@/lib/mock-daily-call";

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return <TooltipProvider><button onClick={() => setOpen(true)}>Abrir colaborador</button><EmployeeDrawer employee={open ? initialEmployees[0] : null} onClose={() => setOpen(false)} onAttendance={vi.fn()} /></TooltipProvider>;
}
function ViewHarness() {
  const [mode, setMode] = useState<"today" | "period">("today");
  return <><ViewModeSelector value={mode} onChange={setMode} /><output>{mode}</output></>;
}

describe("interações essenciais", () => {
  it("abre o drawer do colaborador", async () => { const user = userEvent.setup(); render(<DrawerHarness />); await user.click(screen.getByRole("button", { name: "Abrir colaborador" })); expect(await screen.findByTestId("employee-drawer")).toBeInTheDocument(); expect(screen.getByText("Marina Duarte")).toBeInTheDocument(); });
  it("troca de Hoje para Período", async () => { const user = userEvent.setup(); render(<ViewHarness />); expect(screen.getByText("today")).toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "Período" })); expect(screen.getByText("period")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Período" })).toHaveAttribute("aria-pressed", "true"); });
});
