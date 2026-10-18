/** All instants are epoch milliseconds. All intervals are half-open [start, end). */
export type Instant = number;
export interface Interval { start: Instant; end: Instant }
export type Area = "operation" | "cafeteria" | "perimeter";
export type LocationState = "inside" | "outside" | "unknown";
export type Indicator = "outsideOperation" | "cafeteria" | "outsideCd" | "lateness";
export type Quality = "complete" | "partial" | "unavailable" | "excluded";
export interface Issue { code: string; eventIds: string[]; detail?: string }
export interface Provenance { fileId?: string; row?: number; sourceId: string; origin?: "device" | "manual"; justification?: string; occurrences?: Array<{ fileId?: string; row?: number; sourceId: string }> }
export interface PunchEvent {
  id: string;
  personId: string;
  at: Instant;
  sourceId: string;
  precision: "minute" | "second" | "millisecond";
  /** AFD normally has no role. A role requires independent reconciliation. */
  role?: "start" | "breakStart" | "breakEnd" | "end";
  provenance?: Provenance;
}
export interface AccessEvent {
  id: string;
  personId: string | null;
  at: Instant;
  pointId: string;
  sourceId: string;
  eventClass: string;
  /** Denied, alarm and anonymous events must never move a person. */
  authorized: boolean;
  identified: boolean;
  provenance?: Provenance;
}
export interface DateValidity { validFrom: string; validTo?: string | null }
export interface AccessPointMapping extends DateValidity {
  id: string;
  pointId: string;
  /** Two readers of the same physical portal share this value. */
  portalId: string;
  area: Area;
  direction: "entry" | "exit";
  validated: boolean;
  eventClasses: string[];
  /** Explicit topology, never inferred from equipment names. */
  effects?: Partial<Record<Area, "inside" | "outside">>;
}
export interface Coverage extends Interval {
  area: Area;
  /** Must represent declared completeness of every relevant reader for this area. */
  declaredComplete: boolean;
  sourceIds: string[];
  evidence: string;
}
export interface Schedule {
  id: string;
  expectedStart: Instant;
  expectedEnd: Instant;
  /** Allows pairing untyped punches only when start/end are independently confirmed. */
  pairing: "alternating" | "explicit";
  allowNoBreak: boolean;
  maxSpanMs?: number;
}
export interface JourneyEvidence {
  startConfirmed: boolean;
  endConfirmed: boolean;
  /** Confirms collection covers the expected beginning, not merely min/max timestamps. */
  startCoverageConfirmed: boolean;
  /** An open punch interval is provisional only with explicit present-time coverage. */
  ongoingConfirmed?: boolean;
  punchCoverageUntil?: Instant;
}
export interface GroupSnapshot extends DateValidity {
  groups: string[] | string;
  evidence: string;
}
export interface IndicatorPolicy extends DateValidity {
  id: string;
  indicator: Indicator;
  subjectType: "person" | "group";
  subject: string;
  effect: "include" | "exclude";
  reason: string;
  author: string;
}
export interface Eligibility {
  state: "eligible" | "excluded" | "pending";
  policyIds: string[];
  reasons: string[];
}
export interface RepetitionPolicy {
  version: string;
  punchWindowMs: number;
  accessWindowMs: number;
  /** Untyped close punches are candidates by default, not automatically erased. */
  suppressUntypedPunches: boolean;
}
export interface Suppression {
  eventId: string;
  retainedEventId: string;
  rule: "punch-repetition" | "access-repetition";
  ruleVersion: string;
  differenceMs: number;
}
export interface LocationInterval extends Interval {
  area: Area;
  state: LocationState;
  evidenceEventIds: string[];
}
export interface Journey {
  status: "complete" | "ongoing" | "partial" | "inconsistent" | "empty";
  work: Interval[];
  rest: Interval[];
  provisionalWork: Interval[];
  firstEntry: Instant | null;
  lastExit: Instant | null;
  retainedPunchIds: string[];
  issues: Issue[];
}
export interface Metric {
  /** Null means unavailable/excluded. Partial known durations are explicitly labelled. */
  milliseconds: number | null;
  quality: Quality;
  knownMs: number;
  unknownMs: number;
  coverageRatio: number | null;
  intervals: Interval[];
  eligibility: Eligibility;
}
export interface PairedVisit extends Interval {
  entryEventId: string;
  exitEventId: string;
  workMs: number;
  coffeeMs: number;
  classification: "beforePunch" | "duringRest" | "fromOperation" | "withoutPriorOperation" | "other";
  sequenceEventIds: string[];
}
export interface Lateness {
  quality: Quality;
  reason: string | null;
  totalMs: number | null;
  excessMs: number | null;
  over15Minutes: boolean | null;
  operationalMonth: string;
  eligibility: Eligibility;
}
export interface JourneyCalculationInput {
  personId: string;
  operationalDate: string;
  /** Scope includes pre-punch visits and ends at an explicit finite reference. */
  observationWindow: Interval;
  referenceAt: Instant;
  punchEvents: PunchEvent[];
  accessEvents: AccessEvent[];
  mappings: AccessPointMapping[];
  coverage: Coverage[];
  schedule?: Schedule | null;
  evidence: JourneyEvidence;
  coffeeWindows?: Interval[];
  groupSnapshots?: GroupSnapshot[];
  indicatorPolicies?: IndicatorPolicy[];
  repetitionPolicy?: Partial<RepetitionPolicy>;
  initialLookbackMs?: number;
}
export interface JourneyCalculation {
  personId: string;
  operationalDate: string;
  ruleVersion: string;
  timezone: "America/Sao_Paulo";
  journey: Journey;
  workMs: number | null;
  restMs: number;
  location: LocationInterval[];
  insideOperationMs: number;
  outsideOperation: Metric;
  cafeteria: Metric;
  outsideCd: Metric;
  coffeeDuringWorkMs: number | null;
  cafeteriaObservedMs: number | null;
  cafeteriaVisits: PairedVisit[];
  outsideOperationEpisodes: Array<Interval & { kind: "lateOperationEntry" | "departure"; workMs: number }>;
  betweenOperationExitAndPrincipalEntry: Array<Interval & { exitEventId: string; entryEventId: string; label: "interval-between-events" }>;
  lateness: Lateness;
  suppressions: Suppression[];
  issues: Issue[];
}
