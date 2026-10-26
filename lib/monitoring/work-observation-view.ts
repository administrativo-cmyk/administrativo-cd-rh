import type { WorkObservation } from "./work-observation";

export function workObservation(summary: Record<string, unknown> | null | undefined): WorkObservation | null {
  const value = summary?.workObservation as WorkObservation | undefined;
  return value && ["clock-pair", "turnstile-suggestion"].includes(value.basis)
    && Number.isFinite(value.workedSeconds) && value.workedSeconds >= 0 && Number.isFinite(value.restSeconds) ? value : null;
}
export function displayedWork(summary: Record<string, unknown> | null | undefined): number | null {
  return typeof summary?.workedSeconds === "number" ? summary.workedSeconds : workObservation(summary)?.workedSeconds ?? null;
}
export function displayedRest(summary: Record<string, unknown> | null | undefined): number | null {
  if (typeof summary?.recordedRestSeconds === "number") return summary.recordedRestSeconds;
  if (typeof summary?.workedSeconds === "number" && typeof summary.restSeconds === "number") return summary.restSeconds;
  return workObservation(summary)?.restSeconds ?? null;
}
