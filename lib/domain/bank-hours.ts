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

export function convertHoursToDays(balanceHours: number, workdayHours: number): number {
  if (!Number.isFinite(balanceHours)) throw new RangeError("balanceHours must be finite");
  if (!Number.isFinite(workdayHours) || workdayHours <= 0) {
    throw new RangeError("workdayHours must be greater than zero");
  }

  const balanceMinutes = Math.round(Math.abs(balanceHours) * 60);
  const workdayMinutes = Math.round(workdayHours * 60);
  let days = Math.floor(balanceMinutes / workdayMinutes);
  const remainderMinutes = balanceMinutes % workdayMinutes;

  // The spreadsheet rule says "ultrapassar 5 horas": exactly 5h does not round up.
  if (remainderMinutes > FIVE_HOURS_IN_MINUTES) days += 1;

  if (balanceHours < 0 && days > 0) return -days;
  return days;
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
