import type { WorkspaceAction, WorkspaceSettings } from "./contracts";
export async function workspaceRequest<T>(action: WorkspaceAction, data: unknown = {}, signal?: AbortSignal, options?: Pick<RequestInit, "keepalive">): Promise<T> {
 const response = await fetch("/api/workspace", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }), signal, ...options });
 const body = await response.json();
 if (!response.ok) throw Object.assign(new Error(body.error ?? "Não foi possível concluir a operação."), { code: body.code, status: response.status });
 return body as T;
}
export function applyWorkspacePreferences(settings: WorkspaceSettings) {
 document.documentElement.dataset.density = settings.compactTables ? "compact" : "comfortable";
 window.dispatchEvent(new CustomEvent("workspace-preferences", { detail: settings }));
}
export function notifyInboxChanged() { window.dispatchEvent(new Event("workspace-inbox")); }
