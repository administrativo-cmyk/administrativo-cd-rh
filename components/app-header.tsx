"use client";

import { Bell, ChevronDown, Menu, Search, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { LogoutButton } from "@/components/auth/logout-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AuthenticatedProfile, UserRole } from "@/lib/auth/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { visiblePages } from "@/lib/navigation";
import { workspaceRequest } from "@/lib/workspace/client";
import type { WorkspaceSettings } from "@/lib/workspace/contracts";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrador",
  RH: "RH",
  GESTOR: "Gestor",
  LEITURA: "Leitura",
};

export function AppHeader({
  onMobileOpen,
  profile,
  title = "Chamada Diária",
}: {
  onMobileOpen: () => void;
  profile: AuthenticatedProfile;
  title?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState<number | null>(null);
  const [showCount, setShowCount] = useState(true);
  const [inboxVersion, setInboxVersion] = useState(0);
  const pages = visiblePages(profile.papel_usuario, query);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(value => !value); } };
    const preferences = (event: Event) => { const settings = (event as CustomEvent<WorkspaceSettings>).detail; setShowCount(settings.notificationsEnabled); };
    const inbox = () => setInboxVersion(value => value + 1);
    window.addEventListener("keydown", shortcut); window.addEventListener("workspace-preferences", preferences); window.addEventListener("workspace-inbox", inbox);
    return () => { window.removeEventListener("keydown", shortcut); window.removeEventListener("workspace-preferences", preferences); window.removeEventListener("workspace-inbox", inbox); };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    workspaceRequest<WorkspaceSettings>("settings", {}, abort.signal).then(settings => { if (!abort.signal.aborted) { document.documentElement.dataset.density = settings.compactTables ? "compact" : "comfortable"; setShowCount(settings.notificationsEnabled); } }).catch(() => {});
    return () => abort.abort();
  }, [profile.id]);
  useEffect(() => {
    const abort = new AbortController();
    workspaceRequest<{unread:number}>("notification_summary", {}, abort.signal).then(result => { if (!abort.signal.aborted) setUnread(result.unread); }).catch(() => { if (!abort.signal.aborted) setUnread(null); });
    return () => abort.abort();
  }, [profile.id, inboxVersion]);
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur-md sm:px-4 md:px-5">
      <button aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 lg:hidden" onClick={onMobileOpen}><Menu size={18} /></button>
      <div className="min-w-0 flex-1 md:flex-none"><p className="truncate text-sm font-semibold">{title}</p><p className="hidden text-[11px] text-slate-500 sm:block">Administrativo CD</p></div>
      <button aria-label="Pesquisar páginas" onClick={() => setSearchOpen(true)} className="mx-auto flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 hover:bg-white lg:w-full lg:max-w-72"><Search size={17}/><span className="hidden flex-1 text-left text-sm lg:block">Pesquisar páginas</span><kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] lg:block">Ctrl K</kbd></button>
      <Link href="/notificacoes" aria-label={showCount && unread !== null ? `Notificações: ${unread} não lidas` : "Notificações"} className="relative grid h-11 w-11 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100"><Bell size={18}/>{showCount && unread !== null && unread > 0 ? <span className="absolute right-0 top-0 rounded-full bg-blue-700 px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}</Link>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent><DialogHeader><DialogTitle>Pesquisar páginas</DialogTitle><DialogDescription>Encontre uma área do sistema. Use Tab para navegar pelos resultados.</DialogDescription></DialogHeader><input aria-label="Nome ou assunto da página" value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Ex.: férias, saldos, colaboradores"/><nav aria-label="Resultados da pesquisa" className="max-h-[55dvh] overflow-y-auto"><ul className="space-y-1">{pages.map(page => <li key={page.href}><Link href={page.href} onClick={() => setSearchOpen(false)} className="block rounded-lg p-3 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600"><span className="block text-sm font-semibold">{page.label}</span><span className="block text-xs text-slate-600">{page.description}</span></Link></li>)}</ul>{pages.length === 0 ? <p className="p-4 text-sm text-slate-600">Nenhuma página encontrada.</p> : null}</nav></DialogContent></Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Abrir menu do usuário" className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-slate-50">
            <EmployeeAvatar name={profile.nome_completo} ownProfile />
            <span className="hidden text-left xl:block"><b className="block max-w-40 truncate text-sm">{profile.nome_completo}</b><small className="text-slate-500">{profile.papel_usuario ? roleLabels[profile.papel_usuario] : "Sem papel"}</small></span>
            <ChevronDown size={15} className="hidden text-slate-400 sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Conta do usuário</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/configuracoes#perfil"><UserRound />Meu perfil</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/configuracoes#preferencias"><Settings />Preferências</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><LogoutButton className="flex w-full items-center gap-2 text-rose-700" /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
