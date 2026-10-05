"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attendanceCodes, type AttendanceCode } from "@/lib/daily-call-types";
import { attendanceMeta } from "@/lib/daily-call-rules";
import { cn } from "@/lib/utils";

type Props = { value?: AttendanceCode; onChange?: (code: AttendanceCode) => void; compact?: boolean; label: string; readOnly?: boolean };

export function AttendanceStatusPicker({ value, onChange, compact = false, label, readOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const meta = value ? attendanceMeta[value] : null;
  if (readOnly) {
    return <Tooltip><TooltipTrigger asChild><span aria-label={label} className={cn("inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset", meta ? meta.className : "bg-slate-50 text-slate-500 ring-slate-200")}>{meta ? (compact ? value : meta.label) : (compact ? "—" : "Não lançado")}</span></TooltipTrigger><TooltipContent>Lançamento será habilitado após a validação dos dados reais.</TooltipContent></Tooltip>;
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild><button aria-label={label} className={cn("inline-flex items-center justify-center rounded-lg font-bold ring-1 ring-inset transition hover:-translate-y-px hover:shadow-sm", compact ? "h-8 min-w-8 px-1 text-xs" : "h-9 min-w-20 gap-2 px-2.5 text-sm", meta ? meta.className : "bg-slate-50 text-slate-400 ring-slate-200")}><span>{value ?? "-"}</span>{compact ? null : <ChevronDown size={13} />}</button></PopoverTrigger></TooltipTrigger><TooltipContent>{meta?.label ?? "Definir status"}</TooltipContent></Tooltip>
    <PopoverContent align="start" className="w-[min(320px,calc(100vw-24px))] p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Registrar ocorrência</p><div aria-label="Status da chamada" className="grid grid-cols-2 gap-1.5">{attendanceCodes.map((code) => <button key={code} aria-pressed={value === code} onClick={() => { onChange?.(code); setOpen(false); }} className={cn("flex items-center gap-2 rounded-lg p-2 text-left text-xs transition hover:bg-slate-50 focus-visible:bg-slate-50", value === code && "bg-slate-50")}><span className={cn("grid h-8 min-w-8 place-items-center rounded-md font-bold ring-1 ring-inset", attendanceMeta[code].className)}>{code}</span><span className="flex-1 leading-tight text-slate-700">{attendanceMeta[code].label}</span>{value === code ? <Check size={14} className="text-blue-600" /> : null}</button>)}</div></PopoverContent>
  </Popover>;
}
