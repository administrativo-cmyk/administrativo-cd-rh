import { Info } from "lucide-react";
import { attendanceCodes } from "@/lib/daily-call-types";
import { attendanceMeta } from "@/lib/daily-call-rules";

export function AttendanceLegend() {
  return <aside className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 bg-slate-50/70 px-3 py-2.5"><span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Info size={13} />Legenda</span>{attendanceCodes.map((code) => <span key={code} className="inline-flex items-center gap-1.5 text-xs text-slate-600"><b className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-[10px] ring-1 ring-inset ${attendanceMeta[code].className}`}>{code}</b>{attendanceMeta[code].shortLabel}</span>)}</aside>;
}
