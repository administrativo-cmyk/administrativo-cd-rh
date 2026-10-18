"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { AttendanceCode } from "@/lib/daily-call-types";

type Props = {
  label: string; value: string; status?: AttendanceCode; readOnly: boolean; saving: boolean;
  onSave?: (value: string) => Promise<boolean>;
};

export function DailyCallObservation({ label, value, status, readOnly, saving, onSave }: Props) {
  const [edited, setEdited] = useState<string | null>(null);
  const draft = edited ?? value;
  async function commit() {
    const normalized = draft.trim();
    if (normalized === value) { setEdited(null); return; }
    if (readOnly || !onSave) return;
    try {
      if (await onSave(normalized)) setEdited(null);
    } catch {
      // Keep the local draft available for retry after network failures.
    }
  }
  return <label className="relative block">
    <MessageSquareText size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
    <input aria-label={label} className="h-9 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs"
      placeholder={status ? "Sem observação" : "Selecione um status primeiro"}
      maxLength={500} value={draft} readOnly={readOnly} disabled={readOnly || saving}
      onChange={(event) => setEdited(event.target.value)} onBlur={() => void commit()}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
  </label>;
}
