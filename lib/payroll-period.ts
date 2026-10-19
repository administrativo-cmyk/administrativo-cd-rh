import { validDate } from "./data/daily-call-dates";

const monthLabels = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/** Payroll closes on the 20th; the next cycle starts on the 21st, inclusive. */
export function payrollPeriodForMonth(closingMonth: string) {
  if (!validDate(`${closingMonth}-20`)) throw new Error("INVALID_PAYROLL_MONTH");
  const [year, month] = closingMonth.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 21));
  const years = previous.getUTCFullYear() === year ? String(year) : `${previous.getUTCFullYear()}/${year}`;
  return { key: closingMonth, startDate: previous.toISOString().slice(0, 10), endDate: `${closingMonth}-20`,
    label: `${monthLabels[previous.getUTCMonth()]}/${monthLabels[month - 1]} ${years}` };
}

export function payrollPeriodForDate(date: string) {
  if (!validDate(date)) throw new Error("INVALID_PAYROLL_DATE");
  const [year, month, day] = date.split("-").map(Number);
  return payrollPeriodForMonth(monthKey(new Date(Date.UTC(year, month - 1 + Number(day >= 21), 20))));
}

export function payrollPeriodOptions(date: string) {
  const { key } = payrollPeriodForDate(date);
  const [year, month] = key.split("-").map(Number);
  return Array.from({ length: 37 }, (_, index) => payrollPeriodForMonth(monthKey(new Date(Date.UTC(year, month - 25 + index, 20)))));
}
