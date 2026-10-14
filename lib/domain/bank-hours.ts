import type { AttendanceStatusCode } from "@/lib/daily-call-types";

export type CycleAttendance = {
  date: string;
  status: AttendanceStatusCode;
};

export type BankSituationCode = "EM_DIA" | "A_COMPENSAR" | "A_REPOR";

export type CompensationCycleInput = {
  balanceDays: number;
  effectiveFrom: string;
  nextEffectiveFrom?: string | null;
  attendance: readonly CycleAttendance[];
};

export type CompensationCycleResult = {
  balanceDays: number;
  compensationDaysUsed: number;
  pendingCompensationDays: number;
  replacementDays: number;
  situation: BankSituationCode;
};

const FIVE_HOURS_IN_MINUTES = 5 * 60;

export function convertMinutesToDays(balanceMinutes: number, workdayMinutes: number): number {
  if (!Number.isInteger(balanceMinutes)) throw new RangeError("balanceMinutes must be an integer");
  if (!Number.isInteger(workdayMinutes) || workdayMinutes <= 0) {
    throw new RangeError("workdayMinutes must be a positive integer");
  }
  const absolute = Math.abs(balanceMinutes);
  const wholeDays = Math.floor(absolute / workdayMinutes);
  const extraDay = absolute % workdayMinutes > FIVE_HOURS_IN_MINUTES ? 1 : 0;
  const days = wholeDays + extraDay;
  return days === 0 ? 0 : Math.sign(balanceMinutes) * days;
}

export function formatSignedMinutes(balanceMinutes: number): string {
  if (!Number.isInteger(balanceMinutes)) throw new RangeError("balanceMinutes must be an integer");
  const sign = balanceMinutes < 0 ? "-" : balanceMinutes > 0 ? "+" : "";
  const absolute = Math.abs(balanceMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function convertHoursToDays(balanceHours: number, workdayHours: number): number {
  if (!Number.isFinite(balanceHours)) throw new RangeError("balanceHours must be finite");
  if (!Number.isFinite(workdayHours) || workdayHours <= 0) {
    throw new RangeError("workdayHours must be greater than zero");
  }

  const balanceMinutes = Math.round(Math.abs(balanceHours) * 60);
  const workdayMinutes = Math.round(workdayHours * 60);
  return convertMinutesToDays(balanceHours < 0 ? -balanceMinutes : balanceMinutes, workdayMinutes);
}

export function calculateCompensationCycle(input: CompensationCycleInput): CompensationCycleResult {
  const cycleCompensations = input.attendance.filter((record) => (
    record.status === "G"
    && record.date >= input.effectiveFrom
    && (!input.nextEffectiveFrom || record.date < input.nextEffectiveFrom)
  )).length;

  const compensationDaysUsed = input.balanceDays > 0 ? cycleCompensations : 0;
  const pendingCompensationDays = input.balanceDays > 0
    ? Math.max(input.balanceDays - compensationDaysUsed, 0)
    : 0;
  const replacementDays = input.balanceDays < 0 ? Math.abs(input.balanceDays) : 0;

  return {
    balanceDays: input.balanceDays,
    compensationDaysUsed,
    pendingCompensationDays,
    replacementDays,
    situation: replacementDays > 0
      ? "A_REPOR"
      : pendingCompensationDays > 0
        ? "A_COMPENSAR"
        : "EM_DIA",
  };
}
