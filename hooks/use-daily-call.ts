"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { calculateDailyCallMetrics, countActiveFilters, filterEmployees, filtersForDate, groupEmployeesByManager } from "@/lib/daily-call-selectors";
import { validDate, validPeriod } from "@/lib/data/daily-call-dates";
import { payrollPeriodForDate, payrollPeriodForMonth } from "@/lib/payroll-period";
import { reportOperationalError } from "@/lib/security/operational-error";
import type { AttendanceCode, DailyCallFilters, DailyCallSnapshot, Employee } from "@/lib/daily-call-types";

type WriteResult = { changed: boolean; record: { date: string; status: AttendanceCode; observation: string | null; updatedAt: string } | null };

export function useDailyCall(initialDate: string, initialSnapshot: DailyCallSnapshot | null) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filters, setFilters] = useState(() => filtersForDate(initialDate));
  const [viewMode, setViewMode] = useState<"today" | "period">("today");
  const [groupByManager, setGroupByManager] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const setSelectedEmployee = useCallback((employee: Employee | null) => setSelectedEmployeeId(employee?.id ?? null), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialSnapshot === null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState(initialSnapshot?.loadedAt ?? null);
  const queryVersion = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mutationVersion, setMutationVersion] = useState(0);
  const pendingKeys = useRef(new Set<string>());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const lastRequestKey = useRef(`${initialDate}|${filters.startDate}|${filters.endDate}||0`);
  const employees = useMemo(() => error ? [] : snapshot?.employees ?? [], [snapshot, error]);
  const payrollPeriods = useMemo(() => error ? [] : [...new Set([
    ...(snapshot?.payrollPeriods ?? []),
    ...employees.flatMap(employee => Object.keys(employee.attendance).map(date => payrollPeriodForDate(date).key)),
  ])], [snapshot, employees, error]);
  const selectedEmployee = useMemo(() => employees.find((employee) => employee.id === selectedEmployeeId) ?? null, [employees, selectedEmployeeId]);
  const filteredEmployees = useMemo(() => filterEmployees(employees, filters, selectedDate), [employees, filters, selectedDate]);
  const metrics = useMemo(() => calculateDailyCallMetrics(filteredEmployees, selectedDate), [filteredEmployees, selectedDate]);
  const managerGroups = useMemo(() => groupEmployeesByManager(filteredEmployees), [filteredEmployees]);
  const managerOptions = useMemo(() => [...new Set(employees.map((employee) => employee.manager))].sort((a, b) => a.localeCompare(b, "pt-BR")), [employees]);
  const defaults = useMemo(() => filtersForDate(selectedDate), [selectedDate]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters, defaults), [filters, defaults]);

  useEffect(() => {
    const requestKey = `${selectedDate}|${filters.startDate}|${filters.endDate}|${filters.situation ?? ""}|${refreshKey}`;
    if (lastRequestKey.current === requestKey) return;
    lastRequestKey.current = requestKey;
    const abort = new AbortController();
    activeRead.current = abort;
    const version = ++queryVersion.current;
    const params = new URLSearchParams({ date: selectedDate, start: filters.startDate, end: filters.endDate, situation: filters.situation ?? "" });
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
      .then((result) => {
        if (result && !abort.signal.aborted && version === queryVersion.current) {
          queryVersion.current += 1;
          setSnapshot(result);
          setLastSuccessfulAt(result.loadedAt ?? new Date().toISOString());
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted && version === queryVersion.current) {
          reportOperationalError("daily-call.client-read", cause);
          setError(true);
        }
      })
      .finally(() => {
        if (activeRead.current === abort) activeRead.current = null;
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [selectedDate, filters.startDate, filters.endDate, filters.situation, refreshKey, setSelectedEmployee]);

  const updateFilter = useCallback(<K extends keyof DailyCallFilters>(key: K, value: DailyCallFilters[K]) => setFilters((current) => ({ ...current, [key]: value })), []);
  const clearFilters = useCallback(() => setFilters(filtersForDate(selectedDate)), [selectedDate]);
  const changeDate = useCallback((date: string) => { if (!validDate(date)) return; setSelectedDate(date); setFilters(filtersForDate(date)); }, []);
  const changePayrollPeriod = useCallback((month: string) => {
    const period = payrollPeriodForMonth(month);
    setFilters(current => ({ ...current, startDate: period.startDate, endDate: period.endDate }));
    setSelectedDate(current => current < period.startDate ? period.startDate : current > period.endDate ? period.endDate : current);
  }, []);
  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  const saveAttendance = useCallback(async (employee: Employee, date: string, status: AttendanceCode | null, observation: string | null): Promise<boolean> => {
    const key = `${employee.id}|${date}`;
    if (pendingKeys.current.has(key)) return false;
    if (!employee.databaseId) { toast.error("Identificador do colaborador indisponível. Atualize a página."); return false; }
    if (status === null && observation?.trim()) { toast.error("Selecione um status antes de adicionar observação."); return false; }
    pendingKeys.current.add(key);
    setSavingKeys(new Set(pendingKeys.current));
    const startedQueryVersion = queryVersion.current;
    try {
      const response = await fetch("/api/daily-call/entry", {
        method: "PUT", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ employeeId: employee.databaseId, date, status,
          observation: observation?.trim() || null, expectedUpdatedAt: employee.attendanceVersions?.[date] ?? null }),
      });
      const result: WriteResult & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o lançamento.");
      setMutationVersion((current) => current + 1);
      // A newer GET may already include this write in its bank aggregate, even
      // when the written date is absent from its attendance payload. Revalidate
      // that context instead of applying the same G delta to it a second time.
      if (startedQueryVersion !== queryVersion.current || activeRead.current) {
        activeRead.current?.abort();
        activeRead.current = null;
        queryVersion.current += 1;
        setRefreshKey((current) => current + 1);
        if (result.changed) toast.success("Lançamento salvo.");
        return true;
      }
      setSnapshot((current) => current ? { ...current, employees: current.employees.map((item) => {
        if (item.id !== employee.id) return item;
        const previous = item.attendance[date];
        const attendance = { ...item.attendance };
        const observations = { ...item.observations };
        const attendanceVersions = { ...item.attendanceVersions };
        const attendanceSources = { ...item.attendanceSources };
        if (result.record) {
          attendance[date] = result.record.status;
          if (result.record.observation) observations[date] = result.record.observation;
          else delete observations[date];
          attendanceVersions[date] = result.record.updatedAt;
          attendanceSources[date] = "manual";
        } else {
          delete attendance[date]; delete observations[date]; delete attendanceVersions[date]; delete attendanceSources[date];
        }
        const bank = item.realBank;
        const currentCode = result.record?.status;
        const delta = Number(currentCode === "G") - Number(previous === "G");
        const inCycle = bank && date >= bank.effectiveFrom && date <= current.date;
        const realBank = inCycle && delta ? { ...bank,
          usedCompensationDays: Math.max(bank.usedCompensationDays + delta, 0),
          pendingCompensationDays: Math.max(bank.balanceDays - bank.usedCompensationDays - delta, 0),
        } : bank;
        return { ...item, attendance, observations, attendanceVersions, attendanceSources, realBank };
      }) } : current);
      if (result.changed) toast.success("Lançamento salvo.");
      if (result.changed && employee.situation === "Desligado") setRefreshKey(value => value + 1);
      return true;
    } catch (cause) {
      reportOperationalError("daily-call.client-write", cause);
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o lançamento.");
      return false;
    } finally {
      pendingKeys.current.delete(key);
      setSavingKeys(new Set(pendingKeys.current));
    }
  }, []);
  const isSaving = useCallback((employee: Employee, date: string) => savingKeys.has(`${employee.id}|${date}`), [savingKeys]);

  return { employees, payrollPeriods, filteredEmployees, filters, updateFilter, clearFilters, activeFilterCount, metrics, managerGroups, managerOptions, selectedDate, changeDate, changePayrollPeriod, refresh, loading, error, lastSuccessfulAt, mutationVersion, viewMode, setViewMode, groupByManager, setGroupByManager, selectedEmployee, setSelectedEmployee, saveAttendance, isSaving };
}
