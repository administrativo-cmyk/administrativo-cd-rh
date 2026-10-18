export type AdminEmployee = { id: string; name: string; employeeNumber: string };
export type AdminSnapshot = {
  sources: Array<{ id: string; kind: string; timezone: string; heartbeat_at: string | null; worker_state: string | null; last_success_at: string | null; last_error?: string | null; active?: boolean; label?: string | null; identity_namespace?: string; configuration_updated_at?: string; configuration?: { sourceIdentityConfirmed?: boolean; declaredCoverage?: { from: string; to: string; continuous: boolean } } }>;
  files: Array<{ id: string; source_id: string; relative_path: string; status: string; expected_rows: number | null; accepted_rows: number; attempts: number; last_attempt_at: string; completed_at: string | null; new_events: number; repeated_events: number; conflict_rows: number; rejected_rows: number; processed_rows: number }>;
  settings: Array<{ id: string; kind: string; target: string; valid_from: string; valid_to: string | null; payload: Record<string, unknown>; reason: string; revoked_at: string | null; updated_at?: string; revision?: number; supersedes_id?: string | null }>;
  bindings: Array<{ id: string; source_id: string; identity_type: string; identity_value: string; employee_id: string; valid_from: string; valid_to: string | null; evidence: string; revoked_at: string | null; updated_at?: string; revision?: number; supersedes_id?: string | null }>;
  employees: AdminEmployee[];
  users: Array<{ id: string; name: string }>;
  attempts?: Array<{ id: string | number; source_id: string; relative_path: string; code: string; created_at: string }>;
  jobs?: { pending: number; failed: number };
  pending: Array<{ source_id: string; identity_type: string; identity_value: string; name: string | null }>;
  people?: Array<{ source_id: string; external_id: string; name: string; groups: string[]; photo_reference: string | null; has_photo: boolean; linked: boolean; ambiguous?: boolean }>;
  audit: Array<{ id: string | number; action: string; target: string; created_at?: string; occurred_at?: string; detail: { reason?: string } }>;
};
