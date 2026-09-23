"use client";

import { useCallback, useMemo, useState } from "react";
import { applyAttendanceStatus } from "@/lib/daily-call-rules";
import { calculateDailyCallMetrics, countActiveFilters, defaultDailyCallFilters, filterEmployees, groupEmployeesByManager } from "@/lib/daily-call-selectors";
import { initialEmployees, TODAY } from "@/lib/mock-daily-call";
import type { AttendanceCode, DailyCallFilters, DemoState, Employee } from "@/lib/daily-call-types";

export function useDailyCall() {
  const [employees, setEmployees] = useState(initialEmployees);
  const [filters, setFilters] = useState(defaultDailyCallFilters);
  const [viewMode, setViewMode] = useState<"today" | "period">("today");
  const [groupByManager, setGroupByManager] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [demoState, setDemoState] = useState<DemoState>("ready");
  const filteredEmployees = useMemo(() => filterEmployees(employees, filters, TODAY), [employees, filters]);
  const metrics = useMemo(() => calculateDailyCallMetrics(filteredEmployees, TODAY), [filteredEmployees]);
  const managerGroups = useMemo(() => groupEmployeesByManager(filteredEmployees), [filteredEmployees]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const setAttendance = useCallback((employeeId: string, date: string, code: AttendanceCode) => {
    setEmployees((current) => current.map((employee) => employee.id === employeeId ? applyAttendanceStatus(employee, date, code) : employee));
    setSelectedEmployee((current) => current?.id === employeeId ? applyAttendanceStatus(current, date, code) : current);
  }, []);
  const setObservation = useCallback((employeeId: string, date: string, value: string) => {
    setEmployees((current) => current.map((employee) => employee.id === employeeId ? { ...employee, observations: { ...employee.observations, [date]: value } } : employee));
    setSelectedEmployee((current) => current?.id === employeeId ? { ...current, observations: { ...current.observations, [date]: value } } : current);
  }, []);
  const updateFilter = useCallback(<K extends keyof DailyCallFilters>(key: K, value: DailyCallFilters[K]) => setFilters((current) => ({ ...current, [key]: value })), []);
  const clearFilters = useCallback(() => setFilters(defaultDailyCallFilters), []);

  return { employees, filteredEmployees, filters, updateFilter, clearFilters, activeFilterCount, metrics, managerGroups, viewMode, setViewMode, groupByManager, setGroupByManager, selectedEmployee, setSelectedEmployee, setAttendance, setObservation, demoState, setDemoState };
}
