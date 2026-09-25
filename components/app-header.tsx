"use client";

import { Bell, ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, UserRound } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AuthenticatedProfile, UserRole } from "@/lib/auth/types";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrador",
  RH: "RH",
  GESTOR: "Gestor",
  LEITURA: "Leitura",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppHeader({
  collapsed,
  onToggle,
  onMobileOpen,
  profile,
  title = "Chamada Diária",
}: {
  collapsed: boolean;
  onToggle: () => void;
  onMobileOpen: () => void;
  profile: AuthenticatedProfile;
  title?: string;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur-md sm:px-4 md:px-5">
      <button aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 lg:hidden" onClick={onMobileOpen}><Menu size={18} /></button>
      <button aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} className="hidden h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 lg:grid" onClick={onToggle}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      <div className="min-w-0 flex-1 md:flex-none"><p className="truncate text-sm font-semibold">{title}</p><p className="hidden text-[11px] text-slate-500 sm:block">Administrativo CD</p></div>
      <label className="mx-auto hidden w-full max-w-72 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 lg:flex"><Search size={15} className="text-slate-400" /><input aria-label="Pesquisa global" className="w-full bg-transparent text-sm outline-none" placeholder="Pesquisar no sistema" /><kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400">Ctrl K</kbd></label>
      <button aria-label="Notificações" className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100"><Bell size={18} /><span className="absolute right-2 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-blue-500" /></button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Abrir menu do usuário" className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-slate-50">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{initials(profile.nome_completo)}</span>
            <span className="hidden text-left xl:block"><b className="block max-w-40 truncate text-sm">{profile.nome_completo}</b><small className="text-slate-500">{profile.papel_usuario ? roleLabels[profile.papel_usuario] : "Sem papel"}</small></span>
            <ChevronDown size={15} className="hidden text-slate-400 sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Conta do usuário</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem><UserRound />Meu perfil</DropdownMenuItem>
          <DropdownMenuItem><Settings />Preferências</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><LogoutButton className="flex w-full items-center gap-2 text-rose-700" /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
