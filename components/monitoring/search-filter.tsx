"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { inputClass } from "./shared";

export interface SearchFilterOption { value: string; label: string }
const searchKey = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");

export function SearchFilter({ label, placeholder, allLabel, value, options, onChange }: {
  label: string; placeholder: string; allLabel: string; value: string;
  options: SearchFilterOption[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId(), listId = `${id}-list`;
  const selected = options.find(option => option.value === value);
  function select(next: string) { onChange(next); setOpen(false); }
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="text-xs font-semibold text-slate-600">{label}</label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" className={cn(inputClass, "flex items-center justify-between gap-2 text-left")}><span className="truncate" title={selected?.label}>{selected?.label || value || allLabel}</span><ChevronsUpDown size={15} aria-hidden="true" className="shrink-0 text-slate-500" /></button></PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0 motion-reduce:animate-none">
        <Command label={placeholder} filter={(option, search, keywords) => searchKey([option, ...(keywords ?? [])].join(" ")).includes(searchKey(search)) ? 1 : 0}>
          <CommandInput placeholder={placeholder} aria-label={placeholder} />
          <CommandList id={listId} aria-label={`${label}: opções disponíveis`}>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            <CommandItem value={allLabel} onSelect={() => select("")}><Check size={15} aria-hidden="true" className={value ? "opacity-0" : "text-blue-700"} />{allLabel}</CommandItem>
            {options.map(option => <CommandItem key={option.value} value={option.value} keywords={[option.label]} onSelect={() => select(option.value)}><Check size={15} aria-hidden="true" className={value === option.value ? "text-blue-700" : "opacity-0"} /><span className="break-words">{option.label}</span></CommandItem>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>;
}
