import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudImportPanel } from "./cloud-import-panel";
import { cloudActionSchema, cloudFileLimit, cloudRequest, type CloudJob } from "./cloud-import-client";

const upload = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => vi.fn(() => ({ uploadToSignedUrl: upload })));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: storage } }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "https://example.supabase.co", publishableKey: "synthetic-public-key" }) }));
const sources = [{ id: "clock", name: "Relógio sintético", kind: "afd", afdProfile: "legacy" }, { id: "access", name: "Acessos sintéticos", kind: "defense-access" }, { id: "people", name: "Cadastro sintético", kind: "defense-person" }];
const updatedAt = "2026-10-18T12:00:00Z";
const job = (status: CloudJob["status"], suffix = "1"): CloudJob => ({ id: suffix, fileName: `synthetic-${suffix}.txt`, sourceId: "clock", status, bytes: 30, createdAt: updatedAt, updatedAt, batchesDone: 0, totalBatches: null, errorCode: null });
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
function api(jobs: CloudJob[] = []) {
  const mock = vi.fn(async (url: string, options?: RequestInit) => {
    if (!options?.method || options.method === "GET") return ok({ sources, jobs, maxFileBytes: cloudFileLimit, automationReady: true });
    if (url.endsWith("/complete")) return ok({ id: url.split("/").at(-2), status: "queued", updatedAt });
    return ok({ id: "created", upload: { bucket: "private-imports", path: "created/raw", token: "synthetic-signed-token", url: "https://example.supabase.co/storage/v1/object/upload/sign/private-imports/created/raw" } });
  });
  vi.stubGlobal("fetch", mock); return mock;
}
function file(name = "synthetic.txt", text = "abc") {
  const value = new File([text], name); Object.defineProperty(value, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer }); return value;
}
async function choose(user: ReturnType<typeof userEvent.setup>, source = "clock", name = "synthetic.txt") {
  await user.selectOptions(await screen.findByLabelText("Fonte do arquivo"), source);
  if (source === "clock") await user.selectOptions(screen.getByLabelText("Formato AFD"), "legacy");
  await user.upload(screen.getByLabelText("Arquivo de importação"), file(name));
}
beforeEach(() => { upload.mockReset().mockResolvedValue({ error: null }); storage.mockClear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Envio para processamento na nuvem", () => {
  it.each([false, undefined])("bloqueia novo upload quando automação não está confirmada: %s", async (automationReady) => {
    const fetch = api(); fetch.mockResolvedValue(ok({ sources, jobs: [job("failed")], maxFileBytes: cloudFileLimit, ...(automationReady === undefined ? {} : { automationReady }) }));
    render(<CloudImportPanel />);
    expect(await screen.findByText(/Aguardando ativação da automação no servidor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar arquivo" })).toBeDisabled(); expect(screen.getByLabelText("Fonte do arquivo")).toBeDisabled(); expect(screen.getByLabelText("Arquivo de importação")).toBeDisabled();
    expect(screen.getByText("synthetic-1.txt")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Cancelar synthetic-1.txt" })).toBeEnabled();
    fireEvent.submit(screen.getByRole("form", { name: "Envio de arquivo para processamento na nuvem" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("aguarda ativação"); expect(fetch).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
  });
  it("habilita envio após atualizar prontidão confirmada pelo servidor", async () => {
    const user = userEvent.setup(); const fetch = api(); fetch.mockResolvedValueOnce(ok({ sources, jobs: [], maxFileBytes: cloudFileLimit, automationReady: false })); render(<CloudImportPanel />);
    await screen.findByText(/Aguardando ativação da automação no servidor/); await user.click(screen.getByRole("button", { name: "Atualizar envios" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar arquivo" })).toBeEnabled()); expect(screen.queryByText(/Aguardando ativação da automação no servidor/)).not.toBeInTheDocument();
  });
  it("exige formato AFD explícito mesmo quando a fonte tem um perfil armazenado", async () => {
    const user = userEvent.setup(); const fetch = api(); render(<CloudImportPanel />);
    await user.selectOptions(await screen.findByLabelText("Fonte do arquivo"), "clock");
    expect(screen.getByLabelText("Formato AFD")).toHaveValue("");
    await user.upload(screen.getByLabelText("Arquivo de importação"), file()); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o formato AFD"); expect(fetch.mock.calls).toHaveLength(1); expect(upload).not.toHaveBeenCalled();
  });
  it("barra arquivo acima20MiB e extensão incompatível antes do hash ou reserva", async () => {
    const user = userEvent.setup({ applyAccept: false }); const fetch = api(); render(<CloudImportPanel />); await choose(user);
    const oversized = file(); Object.defineProperty(oversized, "size", { value: cloudFileLimit + 1 });
    await user.upload(screen.getByLabelText("Arquivo de importação"), oversized); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("20 MiB");
    await user.upload(screen.getByLabelText("Arquivo de importação"), file("synthetic.xlsx")); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("somente AFD em arquivo .txt"); expect(fetch.mock.calls).toHaveLength(1); expect(upload).not.toHaveBeenCalled();
  });
  it("calcula SHA256 e só confirma recebimento após upload assinado bem sucedido", async () => {
    const user = userEvent.setup(); const fetch = api(); let finishUpload!: (value: unknown) => void;
    upload.mockReturnValue(new Promise(resolve => { finishUpload = resolve; })); render(<CloudImportPanel />); await choose(user); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ sourceId: "clock", fileName: "synthetic.txt", byteLength: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", afdProfile: "legacy" });
    expect(fetch.mock.calls[1][1]?.credentials).toBe("same-origin"); expect(fetch.mock.calls.some(([url]) => url.endsWith("/complete"))).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Mantenha esta página aberta");
    expect(storage).toHaveBeenCalledWith("private-imports"); expect(upload.mock.calls[0][0]).toBe("created/raw"); expect(upload.mock.calls[0][2].type).toBe("application/octet-stream");
    await act(async () => finishUpload({ error: null }));
    expect(await screen.findByText(/você já pode fechar a página/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/complete"))).toBe(true);
  });
  it("não confirma job quando o Storage falha nem expõe token do erro", async () => {
    const user = userEvent.setup(); const fetch = api(); upload.mockResolvedValue({ error: { message: "synthetic-signed-token" } }); render(<CloudImportPanel />); await choose(user); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O envio do arquivo não foi confirmado");
    expect(screen.queryByText(/você já pode fechar a página/)).not.toBeInTheDocument(); expect(screen.queryByText("synthetic-signed-token")).not.toBeInTheDocument(); expect(fetch.mock.calls.some(([url]) => url.endsWith("/complete"))).toBe(false);
  });
  it("retoma apenas confirmação quando bytes chegaram mas complete falhou", async () => {
    const user = userEvent.setup(); const fetch = api(); let attempt = 0; const implementation = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, options) => url.endsWith("/complete") && attempt++ === 0 ? { ok: false, status: 503, json: async () => ({}) } : implementation(url, options));
    render(<CloudImportPanel />); await choose(user); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar recebimento" }));
    expect(await screen.findByText(/você já pode fechar a página/)).toBeInTheDocument(); expect(upload).toHaveBeenCalledOnce(); expect(attempt).toBe(2);
  });
  it("não reenvia bytes de arquivo já recebido e confirmado pelo servidor", async () => {
    const user = userEvent.setup(); const fetch = api(); const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, options) => options?.method === "POST" ? ok({ id: "existing", status: "completed", alreadyUploaded: true }) : original(url, options));
    render(<CloudImportPanel />); await choose(user); await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
    expect(await screen.findByText(/Este arquivo já foi recebido e processado/)).toBeInTheDocument(); expect(upload).not.toHaveBeenCalled(); expect(fetch.mock.calls.some(([url]) => url.endsWith("/complete"))).toBe(false);
  });
  it("mantém confirmação disponível no histórico após recarregar e explica fotos Person", async () => {
    const user = userEvent.setup(); const fetch = api([job("uploading")]); render(<CloudImportPanel />);
    await user.click(await screen.findByRole("button", { name: "Confirmar envio de synthetic-1.txt" }));
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/monitoring/cloud/1/complete" && options?.body === "{}")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Fonte do arquivo"), "people"); expect(screen.getByText("A planilha não inclui as imagens. As fotos já cadastradas são mantidas.")).toBeInTheDocument(); expect(screen.queryByLabelText("Formato AFD")).not.toBeInTheDocument();
  });
  it("confirmar envio antigo preserva o novo arquivo ainda não enviado", async () => {
    const user = userEvent.setup(); api([job("uploading")]); render(<CloudImportPanel />); await choose(user, "people", "new.xlsx");
    await user.click(screen.getByRole("button", { name: "Confirmar envio de synthetic-1.txt" }));
    expect(await screen.findByText(/O arquivo selecionado no formulário foi mantido/)).toBeInTheDocument();
    expect((screen.getByLabelText("Arquivo de importação") as HTMLInputElement).files?.[0]?.name).toBe("new.xlsx"); expect(upload).not.toHaveBeenCalled();
  });
  it("envia versão no retry/cancel e exige confirmação explícita de cancelamento", async () => {
    const user = userEvent.setup(); const fetch = api([job("failed")]); const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, options) => url.endsWith("/cancel") ? ok({ id: "1", status: "cancelled", updatedAt }) : url.endsWith("/retry") ? ok({ id: "1", status: "queued", updatedAt }) : original(url, options));
    render(<CloudImportPanel />); await user.click(await screen.findByRole("button", { name: "Tentar novamente synthetic-1.txt" }));
    await waitFor(() => expect(fetch.mock.calls.some(([url, options]) => url.endsWith("/retry") && options?.body === JSON.stringify({ expectedUpdatedAt: updatedAt }))).toBe(true));
    await user.click(screen.getByRole("button", { name: "Cancelar synthetic-1.txt" })); expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); expect(await screen.findByText(/Processamento cancelado/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => url.endsWith("/cancel") && options?.body === JSON.stringify({ expectedUpdatedAt: updatedAt }))).toBe(true);
  });
  it("não anuncia sucesso quando ação retorna resposta inválida ou versão alterada", async () => {
    const user = userEvent.setup(); const fetch = api([job("failed")]); const original = fetch.getMockImplementation()!; let attempts = 0;
    fetch.mockImplementation(async (url, options) => url.endsWith("/retry") ? attempts++ === 0 ? ok(null) : { ok: false, status: 409, json: async () => ({}) } : original(url, options));
    render(<CloudImportPanel />); await user.click(await screen.findByRole("button", { name: "Tentar novamente synthetic-1.txt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não confirmou a operação"); expect(screen.queryByText(/Nova tentativa confirmada/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente synthetic-1.txt" })); expect(await screen.findByRole("alert")).toHaveTextContent("mudou em outra sessão");
  });
  it("limita histórico a10 itens por página e filtra sem perder total consultado", async () => {
    const user = userEvent.setup(); api(Array.from({ length: 12 }, (_, index) => job(index === 11 ? "failed" : "completed", String(index)))); render(<CloudImportPanel />);
    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument(); expect(screen.queryByText("synthetic-11.txt")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Próxima" })); expect(screen.getByText("synthetic-11.txt")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filtrar situação"), "failed"); expect(screen.getByText(/1 envio\(s\) nesta consulta/)).toBeInTheDocument(); expect(screen.queryByRole("navigation", { name: "Páginas do histórico de envios" })).not.toBeInTheDocument();
  });
  it("consulta só enquanto há pendência e página visível; aborta no unmount", async () => {
    vi.useFakeTimers(); let visibility = "visible"; vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
    const fetch = api([job("queued")]); const view = render(<CloudImportPanel />);
    await act(async () => { await Promise.resolve(); }); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(fetch).toHaveBeenCalledTimes(2);
    visibility = "hidden"; fireEvent(document, new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetch).toHaveBeenCalledTimes(2);
    visibility = "visible"; await act(async () => { fireEvent(document, new Event("visibilitychange")); }); expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    const lastSignal = fetch.mock.calls.at(-1)?.[1]?.signal; view.unmount(); expect(lastSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(20000)); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("não faz polling de histórico concluído", async () => {
    vi.useFakeTimers(); const fetch = api([job("completed")]); const view = render(<CloudImportPanel />);
    await act(async () => { await Promise.resolve(); }); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetch).toHaveBeenCalledOnce(); view.unmount();
  });
  it("não interrompe consulta lenta a cada tick do polling", async () => {
    vi.useFakeTimers(); const fetch = api([job("queued")]); const view = render(<CloudImportPanel />);
    await act(async () => { await Promise.resolve(); }); fetch.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(false); view.unmount();
  });
  it("remove alerta de polling após recuperação da consulta", async () => {
    vi.useFakeTimers(); const fetch = api([job("queued")]); const view = render(<CloudImportPanel />);
    await act(async () => { await Promise.resolve(); }); fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ code: "CLOUD_UNAVAILABLE" }) });
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(screen.getByRole("alert")).toHaveTextContent("indisponível");
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(screen.queryByRole("alert")).not.toBeInTheDocument(); view.unmount();
  });
  it("aborta upload no unmount e não confirma trabalho após sair da tela", async () => {
    const user = userEvent.setup(); const fetch = api(); let finishUpload!: (value: unknown) => void;
    upload.mockReturnValue(new Promise(resolve => { finishUpload = resolve; })); const view = render(<CloudImportPanel />);
    await choose(user); await user.click(screen.getByRole("button", { name: "Enviar arquivo" })); await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    const createSignal = fetch.mock.calls.find(([url, options]) => url === "/api/monitoring/cloud" && options?.method === "POST")?.[1]?.signal;
    view.unmount(); expect(createSignal?.aborted).toBe(true); await act(async () => finishUpload({ error: null }));
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/complete"))).toBe(false);
  });
  it("distingue quota409 de conflito de versão e nunca mostra mensagem bruta de Storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "CLOUD_QUOTA", error: "synthetic-private-path" }) }));
    await expect(cloudRequest("/api/monitoring/cloud/1/retry", cloudActionSchema, new AbortController().signal, { expectedUpdatedAt: updatedAt })).rejects.toThrow("O limite da fila ou do armazenamento foi atingido");
  });
});
