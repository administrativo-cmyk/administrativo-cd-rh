export type SourceKind = "afd" | "defense-access" | "defense-person";
export type AfdProfile = "legacy" | "iso";
export type IdentifierType = "cpf" | "pis" | "defense";
export type EventClassification = "authorized" | "denied" | "alarm" | "anonymous" | "unknown";

export interface IngestionSource {
  id: string;
  kind: SourceKind;
  root: string;
  timeZone: string;
  identityNamespace?: string;
  /** Local authorization switch. Remote metadata can disable, never enable this switch. */
  enabled?: boolean;
  recursive?: boolean;
  /** A fragment cannot prove the equipment identity; an operator must validate it. */
  sourceIdentityConfirmed?: boolean;
  afdProfile?: AfdProfile;
  /** Identifier semantics are independent from the AFD timestamp layout. */
  afdIdentityType?: "cpf" | "pis";
  encoding?: "utf8" | "latin1";
  photoRoot?: string;
  declaredCoverage?: { from: string; to: string; continuous: boolean };
}

export interface IngestionIssue {
  code: string;
  severity: "warning" | "error";
  line?: number;
}

export interface CanonicalImportEvent {
  key: string;
  type: "punch" | "access";
  identity: { type: IdentifierType; value: string } | null;
  timestamp: string;
  device: string;
  classification: EventClassification;
  eligible: boolean;
  rawTimestamp: string;
  rawIdentifier: string;
  nsr?: string;
  precisionSeconds: number;
  /** Different snapshots preserve these values without changing the canonical key. */
  original: Record<string, string>;
  checksumStatus?: "not_verified";
  evidence?: "access_authorization" | "punch_record";
}

export interface ImportedPerson {
  externalId: string;
  name: string;
  groups: string[];
  groupPaths?: string[];
  photoReference: string | null;
  original: Record<string, string>;
}

export interface ImportOccurrence {
  key: string;
  line: number;
  sheet?: string;
  payloadHash: string;
  /** Ordinal within a file for indistinguishable events; never part of event identity. */
  multiplicityOrdinal?: number;
  event?: CanonicalImportEvent;
  person?: ImportedPerson;
  original: Record<string, string>;
  issues: IngestionIssue[];
}

export interface ParsedImport {
  parserVersion: string;
  sourceId: string;
  sha256: string;
  byteLength: number;
  totalRows: number;
  occurrences: ImportOccurrence[];
  issues: IngestionIssue[];
  skipped?: boolean;
  observedRange: { from: string; to: string } | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface IngestBatch {
  protocolVersion: 1;
  source: Pick<IngestionSource, "id" | "kind" | "timeZone" | "identityNamespace" | "sourceIdentityConfirmed" | "declaredCoverage">;
  file: { sha256: string; byteLength: number; parserVersion: string; relativePath: string; issues: IngestionIssue[]; observedRange: ParsedImport["observedRange"]; metadata: ParsedImport["metadata"] };
  batch: { index: number; final: boolean; totalRows: number; occurrenceCount: number; totalBatches: number };
  occurrences: ImportOccurrence[];
}

export interface IngestBatchResponse {
  accepted: boolean;
  fileStatus?: "processing" | "complete" | "conflict" | "failed";
  newEvents?: number;
  repeatedEvents?: number;
  conflicts?: number;
  rejected?: number;
}

export interface IngestionTransport {
  sources?(request: { sourceIds: string[] }): Promise<{ sources: ManagedWorkerSource[] }>;
  persist(batch: IngestBatch): Promise<IngestBatchResponse>;
  heartbeat(sourceId: string, state: "scanning" | "idle" | "error", code?: string, source?: IngestBatch["source"]): Promise<void>;
  failure?(failure: { sourceId: string; relativePath: string; code: string }): Promise<void>;
  reprocess?(request: { sourceIds: string[]; limit: number }): Promise<{ processed: number; pending: number; failed: number }>;
  photo?(photo: { sourceId: string; identityValue: string; sha256: string; mimeType: string; base64: string }): Promise<void>;
}

export interface ManagedWorkerSource {
  id: string; kind: SourceKind; timeZone: string; identityNamespace: string; active: boolean;
  configurationUpdatedAt: string; sourceIdentityConfirmed: boolean;
  declaredCoverage: { from: string; to: string; continuous: boolean } | null;
}

export interface WorkerConfig {
  version: 1;
  sources: IngestionSource[];
  stateDirectory: string;
  endpoint?: string;
  tokenEnvironmentVariable?: string;
  scanIntervalMs?: number;
  stabilityMs?: number;
  maxFileBytes?: number;
  batchSize?: number;
}
