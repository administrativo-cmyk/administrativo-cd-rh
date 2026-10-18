export function parseMeasuredBalance(value: string): number | null {
  const match = /^([+-]?)(\d{1,6}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const absolute = Number(match[2]) * 60 + Number(match[3]);
  if (absolute > 10_000_000) return null;
  return match[1] === "-" && absolute ? -absolute : absolute;
}
