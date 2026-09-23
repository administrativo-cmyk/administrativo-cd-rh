"use client";

import { ChevronDown, Users } from "lucide-react";
import { TodayTable } from "./today-table";
import type { ComponentProps } from "react";

export function ManagerGroup({ manager, employees, ...props }: ComponentProps<typeof TodayTable> & { manager: string }) {
  return <details open className="group border-b border-slate-200 last:border-b-0"><summary className="flex cursor-pointer list-none items-center gap-3 bg-slate-50 px-4 py-3 transition hover:bg-slate-100"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200"><Users size={15} /></span><div className="flex-1"><b className="block text-sm">{manager}</b><span className="text-xs text-slate-500">{employees.length} {employees.length === 1 ? "colaborador" : "colaboradores"}</span></div><ChevronDown size={17} className="text-slate-400 transition group-open:rotate-180" /></summary><TodayTable employees={employees} {...props} /></details>;
}
