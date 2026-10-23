"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, Search, ShieldBan, UserCheck, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import type { AccessRequestStatus, AuthenticatedProfile, UserRole } from "@/lib/auth/types";
import type { VersionedAdministrativeUser } from "@/lib/administration/users-contracts";
import { UserEditForm } from "./user-edit-form";
import { userAdminService, type ManagerOption } from "@/lib/auth/user-admin-service";
import { assignableRolesFor, canManageRole } from "@/lib/auth/admin-permissions";
import { cn } from "@/lib/utils";

const roleLabels: Record<UserRole, string> = { ADMIN: "Admin", RH: "RH", GESTOR: "Gestor", LEITURA: "Leitura" };
const statusLabels: Record<AccessRequestStatus, string> = { PENDENTE: "Pendente", APROVADO: "Aprovado", BLOQUEADO: "Bloqueado" };

function dateLabel(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function StatusBadge({ status }: { status: AccessRequestStatus }) {
  const styles = status === "PENDENTE" ? "bg-amber-50 text-amber-700" : status === "APROVADO" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", styles)}>{statusLabels[status]}</span>;
}

export function UsersAdminPage({ profile }: { profile: AuthenticatedProfile }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [users, setUsers] = useState<VersionedAdministrativeUser[]>([]);
  const [editing, setEditing] = useState<VersionedAdministrativeUser | null>(null);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [status, setStatus] = useState<AccessRequestStatus | "">("");
  const [role, setRole] = useState<UserRole | "">("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [approvalRoles, setApprovalRoles] = useState<Record<string, UserRole>>({});
  const [approvalManagers, setApprovalManagers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await userAdminService.list({ status: status || null, role: role || null, search: appliedSearch }));
    } catch {
      setMessage("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, role, status]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      userAdminService.list({ status: status || null, role: role || null, search: appliedSearch }),
      userAdminService.listManagers(),
    ])
      .then(([nextUsers, nextManagers]) => {
        if (active) { setUsers(nextUsers); setManagers(nextManagers); }
      })
      .catch(() => {
        if (active) setMessage("Não foi possível carregar os usuários.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [appliedSearch, role, status]);

  async function runAction(userId: string, action: () => Promise<void>, success: string) {
    setBusyId(userId);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await loadUsers();
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "A operação não pôde ser concluída com suas permissões atuais.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const assignableRoles = assignableRolesFor(profile.papel_usuario);

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Usuários" />
      <section className="lg:pl-18">
        <AppHeader onMobileOpen={() => setMobileOpen(true)} profile={profile} title="Usuários" />
        <div className="mx-auto max-w-[1500px] space-y-4 p-3 sm:p-4 md:p-5">
          <header>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Administração de acesso</p>
            <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Usuários</h1>
            <p className="mt-1 text-sm text-slate-500">Aprove, edite, bloqueie ou reative acessos conforme seu papel administrativo.</p>
          </header>

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/4%)] sm:p-4">
            <div className="grid gap-3 md:grid-cols-[180px_180px_1fr_auto]">
              <label className="text-xs font-semibold text-slate-600">Status<select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as AccessRequestStatus | "")} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Todos</option><option value="PENDENTE">Pendente</option><option value="APROVADO">Aprovado</option><option value="BLOQUEADO">Bloqueado</option></select></label>
              <label className="text-xs font-semibold text-slate-600">Papel<select aria-label="Filtrar por papel" value={role} onChange={(event) => setRole(event.target.value as UserRole | "")} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Todos</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-600">Nome ou CPF completo<div className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3"><Search size={15} className="text-slate-400" /><input aria-label="Buscar por nome ou CPF completo" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setAppliedSearch(search); }} className="w-full bg-transparent text-sm outline-none" placeholder="Nome ou 11 dígitos exatos" /></div></label>
              <button type="button" onClick={() => setAppliedSearch(search)} className="mt-auto h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Buscar</button>
            </div>
          </section>

          {message ? <p role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</p> : null}
          {editing ? <UserEditForm key={`${editing.id}:${editing.updated_at}`} user={editing} roles={assignableRoles} managers={managers} cancel={() => setEditing(null)} save={data => runAction(editing.id, () => userAdminService.edit(data), "Usuário atualizado. Alteração auditada.")} /> : null}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-semibold"><Users size={17} />{users.length} usuário(s)</div>
            {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />Carregando usuários...</div> : users.length === 0 ? <div className="min-h-56 p-10 text-center text-sm text-slate-500">Nenhum usuário encontrado.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Nome</th><th className="px-4 py-3">CPF</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Papel</th><th className="px-4 py-3">Solicitação</th><th className="px-4 py-3">Aprovação</th><th className="px-4 py-3">Ações</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((user) => {
                      const selectedRole = approvalRoles[user.id] ?? assignableRoles.at(-1) ?? "LEITURA";
                      const approvalManager = approvalManagers[user.id] ?? "";
                      const isSelf = user.id === profile.id;
                      const canManageUser = user.status_usuario === "PENDENTE"
                        ? assignableRoles.length > 0
                        : canManageRole(profile.papel_usuario, user.papel_usuario);
                      return <tr key={user.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-semibold text-slate-800">{user.nome_completo}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{user.cpf_mascarado}</td>
                        <td className="px-4 py-3"><StatusBadge status={user.status_usuario} /></td>
                        <td className="px-4 py-3 text-slate-600">{user.papel_usuario ? roleLabels[user.papel_usuario] : "Não definido"}{user.papel_usuario === "GESTOR" && user.visualizar_todos_gestores ? <span className="mt-1 block text-xs font-semibold text-blue-700">Visualiza todos os gestores</span> : null}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{dateLabel(user.created_at)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{dateLabel(user.aprovado_em)}</td>
                        <td className="px-4 py-3">
                          {user.status_usuario === "PENDENTE" ? <div className="space-y-2"><div className="flex gap-2"><select aria-label={`Papel para ${user.nome_completo}`} value={selectedRole} onChange={(event) => setApprovalRoles((current) => ({ ...current, [user.id]: event.target.value as UserRole }))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs">{assignableRoles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}</select><button type="button" disabled={busyId === user.id || (selectedRole === "GESTOR" && !approvalManager)} onClick={() => void runAction(user.id, () => userAdminService.approve(user.id, selectedRole, approvalManager || null), "Usuário aprovado com sucesso.")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-60"><Check size={14} />Aprovar</button></div>{selectedRole === "GESTOR" ? <ManagerSelect label={`Gestor do quadro para ${user.nome_completo}`} value={approvalManager} managers={managers} onChange={(value) => setApprovalManagers((current) => ({ ...current, [user.id]: value }))} /> : null}</div> : null}
                          {user.status_usuario !== "PENDENTE" && canManageUser ? <button type="button" disabled={busyId === user.id} onClick={() => setEditing(user)} className="mb-2 mr-2 min-h-11 rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 disabled:opacity-40">Editar usuário</button> : null}
                          {user.status_usuario === "APROVADO" && canManageUser ? <button type="button" disabled={busyId === user.id || isSelf} title={isSelf ? "Você não pode bloquear seu próprio acesso." : undefined} onClick={() => void runAction(user.id, () => userAdminService.block(user.id), "Usuário bloqueado com sucesso.")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-60"><ShieldBan size={14} />Bloquear</button> : null}
                          {user.status_usuario === "BLOQUEADO" && canManageUser ? <button type="button" disabled={busyId === user.id} onClick={() => void runAction(user.id, () => userAdminService.reactivate(user.id), "Usuário reativado com sucesso.")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-60"><UserCheck size={14} />Reativar</button> : null}
                          {user.status_usuario !== "PENDENTE" && !canManageUser ? <span className="text-xs text-slate-400">Sem permissão para gerenciar</span> : null}
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function ManagerSelect({ label, value, managers, onChange }: { label: string; value: string; managers: ManagerOption[]; onChange: (value: string) => void }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-44 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="">Selecione o gestor do quadro</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.nome}</option>)}</select>;
}
