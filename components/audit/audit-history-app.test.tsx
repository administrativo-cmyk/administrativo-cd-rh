import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditHistoryApp } from "./audit-history-app";
import { defaultAuditQuery, type AuditSnapshot } from "@/lib/audit/contracts";
const snapshot: AuditSnapshot = { total: 51, offset: 0, limit: 50, snapshot: "2026-10-17T20:00:00+00:00", rows: [{ id: "test:1", domain: "cadastros", entity: "employee", recordId: "synthetic", action: "save", actorId: "10000000-0000-4000-8000-000000000001", actorName: "Gestão sintética", createdAt: "2026-10-17T12:00:00Z", reason: "Revisão conferida", before: { setor: "Origem" }, after: { setor: "Destino" }, employeeId: null, employeeName: "Pessoa sintética", employeeNumber: "TEST-1" }] };
const fetcher = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); fetcher.mockResolvedValue({ ok: true, json: async () => snapshot }); });
it("consulta seguinte conserva o corte temporal e mostra valores antes/depois", async () => {
 const user = userEvent.setup(); render(<AuditHistoryApp initialQuery={defaultAuditQuery("2026-10-17")} isAdmin />);
 await screen.findByText("51 registros encontrados"); await user.click(screen.getByRole("button", { name: "Ver alteração test:1" }));
 expect(screen.getByText("Origem")).toBeInTheDocument(); expect(screen.getByText("Destino")).toBeInTheDocument();
 await user.keyboard("{Escape}"); await user.click(screen.getByRole("button", { name: "Próxima" }));
 await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ offset: 50, snapshot: snapshot.snapshot });
});
it("limita áreas para RH e exibe falha sem manter exportação de resultado antigo", async () => {
 const user = userEvent.setup(); render(<AuditHistoryApp initialQuery={defaultAuditQuery("2026-10-17")} isAdmin={false} />);
 await screen.findByText("51 registros encontrados"); expect(screen.queryByRole("option", { name: "Usuários" })).not.toBeInTheDocument();
 fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Serviço temporariamente indisponível" }) });
 await user.click(screen.getByRole("button", { name: "Atualizar" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Serviço temporariamente indisponível");
 expect(screen.getByRole("button", { name: "Exportar esta página" })).toBeDisabled();
 expect(screen.queryByText("Pessoa sintética")).not.toBeInTheDocument();
});
