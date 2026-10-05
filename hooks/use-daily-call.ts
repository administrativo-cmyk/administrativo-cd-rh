"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateDailyCallMetrics, countActiveFilters, filterEmployees, filtersForDate, groupEmployeesByManager } from "@/lib/daily-call-selectors";
import { validPeriod } from "@/lib/data/daily-call-dates";
import type { DailyCallFilters, DailyCallSnapshot, Employee } from "@/lib/daily-call-types";

export function useDailyCall(initialDate: string, initialSnapshot: DailyCallSnapshot | null) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filters, setFilters] = useState(() => filtersForDate(initialDate));
  const [viewMode, setViewMode] = useState<"today" | "period">("today");
  const [groupByManager, setGroupByManager] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialSnapshot === null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastRequestKey = useRef(`${initialDate}|${filters.startDate}|${filters.endDate}|0`);
  const employees = useMemo(() => error ? [] : snapshot?.employees ?? [], [snapshot, error]);
  const filteredEmployees = useMemo(() => filterEmployees(employees, filters, selectedDate), [employees, filters, selectedDate]);
  const metrics = useMemo(() => calculateDailyCallMetrics(filteredEmployees, selectedDate), [filteredEmployees, selectedDate]);
  const managerGroups = useMemo(() => groupEmployeesByManager(filteredEmployees), [filteredEmployees]);
  const managerOptions = useMemo(() => [...new Set(employees.map((employee) => employee.manager))].sort((a, b) => a.localeCompare(b, "pt-BR")), [employees]);
  const defaults = useMemo(() => filtersForDate(selectedDate), [selectedDate]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters, defaults), [filters, defaults]);

  useEffect(() => {
    const requestKey = `${selectedDate}|${filters.startDate}|${filters.endDate}|${refreshKey}`;
    if (lastRequestKey.current === requestKey) return;
    lastRequestKey.current = requestKey;
    const abort = new AbortController();
    const params = new URLSearchParams({ date: selectedDate, start: filters.startDate, end: filters.endDate });
    Promise.resolve().then(() => {
      if (abort.signal.aborted) return null;
      if (!validPeriod(filters.startDate, filters.endDate)) { setError(true); return null; }
      setLoading(true);
      setError(false);
      return fetch(`/api/daily-call?${params}`, { signal: abort.signal, cache: "no-store" });
    })
      .then(async (response) => {
        if (!response) return null;
        if (!response.ok) throw new Error("Falha ao consultar Chamada Diária");
        return response.json() as Promise<DailyCallSnapshot>;
      })
      .then((result) => { if (result) { setSnapshot(result); setSelectedEmployee(null); } })
      .catch((cause: unknown) => { if (cause instanceof Error && cause.name !== "AbortError") { setSelectedEmployee(null); setError(true); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [selectedDate, filters.startDate, filters.endDate, refreshKey]);

  const updateFilter = useCallback(<K extends keyof DailyCallFilters>(key: K, value: DailyCallFilters[K]) => setFilters((current) => ({ ...current, [key]: value })), []);
  const clearFilters = useCallback(() => setFilters(filtersForDate(selectedDate)), [selectedDate]);
  const changeDate = useCallback((date: string) => { setSelectedDate(date); setFilters(filtersForDate(date)); }, []);
  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  return { employees, filteredEmployees, filters, updateFilter, clearFilters, activeFilterCount, metrics, managerGroups, managerOptions, selectedDate, changeDate, refresh, loading, error, viewMode, setViewMode, groupByManager, setGroupByManager, selectedEmployee, setSelectedEmployee };
}
