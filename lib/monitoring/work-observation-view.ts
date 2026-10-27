import type { WorkObservation, WorkSuggestion } from "./work-observation";

export function suggestedWorkMarks(observation: WorkObservation | null | undefined): WorkSuggestion[] {
  return observation?.suggestedMarks ?? (observation?.exitSuggestion ? [{ ...observation.exitSuggestion, role: "end" }] : []);
}

export function workObservation(summary: Record<string, unknown> | null | undefined): WorkObservation | null {
  const value = summary?.workObservation as WorkObservation | undefined;
  return value && ["clock-pair", "turnstile-suggestion"].includes(value.basis)
    && Number.isFinite(value.workedSeconds) && value.workedSeconds >= 0 && Number.isFinite(value.restSeconds) ? value : null;
}
export function displayedWork(summary: Record<string, unknown> | null | undefined): number | null {
  return workObservation(summary)?.workedSeconds ?? (typeof summary?.workedSeconds === "number" ? summary.workedSeconds : null);
}
export function displayedRest(summary: Record<string, unknown> | null | undefined): number | null {
  if (workObservation(summary)) return workObservation(summary)!.restSeconds;
  if (typeof summary?.recordedRestSeconds === "number") return summary.recordedRestSeconds;
  if (typeof summary?.workedSeconds === "number" && typeof summary.restSeconds === "number") return summary.restSeconds;
  return workObservation(summary)?.restSeconds ?? null;
}
