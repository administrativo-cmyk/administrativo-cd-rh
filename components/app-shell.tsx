"use client";

import { useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AuthenticatedProfile } from "@/lib/auth/types";

export function AppShell({ profile, title, activeLabel, children }: {
  profile: AuthenticatedProfile;
  title: string;
  activeLabel: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <TooltipProvider delayDuration={250}>
    <div className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <a href="#page-content" className="sr-only z-[60] rounded-lg bg-white p-3 text-blue-800 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Ir para o conteúdo</a>
      <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel={activeLabel} />
      <div className="min-w-0 lg:pl-18">
        <AppHeader onMobileOpen={() => setMobileOpen(true)} profile={profile} title={title} />
        <main id="page-content" className="mx-auto max-w-[1720px] space-y-5 p-3 sm:p-4 md:p-5">{children}</main>
      </div>
    </div>
  </TooltipProvider>;
}
