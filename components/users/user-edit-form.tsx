"use client";
import { useState } from "react";
import { userEditSchema, type UserEditInput, type VersionedAdministrativeUser } from "@/lib/administration/users-contracts";
import type { UserRole } from "@/lib/auth/types";
import type { ManagerOption } from "@/lib/auth/user-admin-service";

export function UserEditForm({ user, roles, managers, save, cancel }: { user: VersionedAdministrativeUser; roles: UserRole[]; managers: ManagerOption[]; save: (data: UserEditInput) => Promise<boolean>; cancel: () => void }) {
  const [name, setName] = useState(user.nome_completo);
  const [role, setRole] = useState<UserRole>(user.papel_usuario ?? "LEITURA");
  const [managerId, setManagerId] = useState(user.gestor_id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600";
  return <form aria-label="Editar usuário" className="space-y-3 rounded-xl border border-blue-200 bg-white p-4" onSubmit={async event => {
    event.preventDefault();
    const parsed = userEditSchema.safeParse({ id: user.id, expectedUpdatedAt: user.updated_at, name, role, managerId: role === "GESTOR" ? managerId : null, reason });
    if (!parsed.success) { setError("Revise o nome, papel, gestor e justificativa de pelo menos cinco caracteres."); return; }
    setBusy(true); setError("");
    try { if (await save(parsed.data)) cancel(); } finally { setBusy(false); }
  }}>
    <h2 className="font-semibold">Editar acesso de {user.nome_completo}</h2>
    <p className="text-xs text-slate-600">Nome, papel e vínculo são gravados juntos, com histórico. A alteração não aprova nem reativa o acesso.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold">Nome completo<input required minLength={2} maxLength={200} className={input} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="text-xs font-semibold">Papel do usuário<select className={input} value={role} onChange={event => setRole(event.target.value as UserRole)}>{roles.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      {role === "GESTOR" ? <label className="text-xs font-semibold">Gestor do quadro<select required className={input} value={managerId} onChange={event => setManagerId(event.target.value)}><option value="">Selecione</option>{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.nome}</option>)}</select></label> : null}
      <label className="text-xs font-semibold sm:col-span-2">Justificativa da edição<textarea required minLength={5} maxLength={1000} className={input} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label>
    </div>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><button disabled={busy} className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar edição"}</button><button type="button" disabled={busy} onClick={cancel} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm">Cancelar edição</button></div>
  </form>;
}
