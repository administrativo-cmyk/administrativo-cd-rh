"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "./shared";
import { useGroupCatalog } from "./use-group-catalog";

const searchKey = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");

export function GroupFilter({ value, onChange }: { value: string; onChange: (group: string) => void }) {
  const { catalog, error, retry } = useGroupCatalog("query");
  const [open, setOpen] = useState(false);
  const id = useId(), listId = `${id}-list`, hintId = `${id}-hint`;
  const groups = [...new Set(catalog?.groups ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  function select(group: string) { onChange(group); setOpen(false); }
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="text-xs font-semibold text-slate-600">Grupo</label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-describedby={hintId} className={cn(inputClass, "flex items-center justify-between gap-2 text-left")}><span className="truncate">{value || "Todos os grupos"}</span><ChevronsUpDown size={15} aria-hidden="true" className="shrink-0 text-slate-500" /></button></PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0 motion-reduce:animate-none">
        <Command label="Pesquisar grupos" filter={(option, search) => searchKey(option).includes(searchKey(search)) ? 1 : 0}>
          <CommandInput placeholder="Pesquisar grupo pelo nome…" aria-label="Pesquisar grupos" />
          <CommandList id={listId} aria-label="Grupos disponíveis">
            {!catalog && !error ? <p role="status" className="px-3 py-2 text-xs text-slate-500">Carregando grupos…</p> : catalog && !groups.length ? <p role="status" className="px-3 py-2 text-xs text-slate-500">Nenhum grupo encontrado no seu escopo.</p> : null}
            <CommandEmpty>{catalog ? "Nenhum grupo encontrado." : error ? "Grupos indisponíveis." : "Carregando grupos…"}</CommandEmpty>
            <CommandItem value="Todos os grupos" onSelect={() => select("")}><Check size={15} aria-hidden="true" className={value ? "opacity-0" : "text-blue-700"} />Todos os grupos</CommandItem>
            {groups.map(group => <CommandItem key={group} value={group} onSelect={() => select(group)}><Check size={15} aria-hidden="true" className={value === group ? "text-blue-700" : "opacity-0"} /><span className="break-words">{group}</span></CommandItem>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <p id={hintId} className="text-[11px] text-slate-500">Pesquise e selecione. Novos grupos são atualizados automaticamente.</p>
    {error ? <div className="space-y-1"><p role="alert" className="text-xs text-rose-900">{error} {catalog ? "A lista anterior foi mantida." : "Você pode consultar sem filtrar por grupo."}</p><button type="button" className={buttonClass} onClick={retry}>Tentar carregar grupos</button></div> : null}
  </div>;
}
