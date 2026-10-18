import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { identityReviewCandidates } from "../lib/monitoring/identity-review.ts";
import { parseWorkbook } from "../lib/monitoring/ingestion/parsers.ts";
import { normalizeIdentifier } from "../lib/monitoring/ingestion/validation.ts";
import type { IngestionSource } from "../lib/monitoring/ingestion/types.ts";

// Local read-only audit. Only counts leave memory; no bindings or identity exports.
const args = process.argv.slice(2);
const argument = (flag: string) => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1]) throw new Error("AUDIT_ARGUMENT_REQUIRED"); return args[index + 1]; };
const employeesInput: unknown = JSON.parse(await readFile(resolve(argument("--employees")), "utf8"));
const employees = (Array.isArray(employeesInput) ? employeesInput : []).map((row: Record<string, unknown>) => {
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.employeeNumber !== "string") throw new Error("INVALID_REVIEW_EMPLOYEE");
  return { id: row.id, name: row.name, employeeNumber: row.employeeNumber };
});
if (!employees.length) throw new Error("REVIEW_EMPLOYEES_REQUIRED");
const config = JSON.parse(await readFile(resolve(argument("--config")), "utf8")) as { sources: IngestionSource[] };
const personSource = config.sources.find((source) => source.kind === "defense-person");
if (!personSource) throw new Error("PERSON_SOURCE_REQUIRED");
const parsed = await parseWorkbook(await readFile(resolve(argument("--person"))), personSource);
const people = parsed.occurrences.flatMap((row) => row.person ? [row.person] : []);
const countCandidates = (names: string[]) => names.reduce((counts, name) => {
  const candidates = identityReviewCandidates(name, employees);
  counts[candidates.length === 0 ? "none" : candidates.length === 1 ? "unique" : "homonyms"] += 1;
  return counts;
}, { unique: 0, homonyms: 0, none: 0 });
const afd = [];
for (const [flag, profile] of [["--afd-legacy", "legacy"], ["--afd-iso", "iso"]] as const) {
  if (!args.includes(flag)) continue;
  const lines = (await readFile(resolve(argument(flag)))).toString(profile === "legacy" ? "latin1" : "utf8").split(/\r?\n/).filter(Boolean);
  const names = new Map<string, Set<string>>(); let valid = 0; let rejected = 0;
  const registrations = lines.filter((line) => line[9] === "5");
  for (const line of registrations) {
    // Documented worker fields only. Trailing responsible-CPF is never read.
    const iso = profile === "iso";
    const operation = line[iso ? 34 : 22];
    const name = line.slice(iso ? 47 : 35, iso ? 99 : 87).trim();
    if (!/^[IAE]$/.test(operation) || !name || line.length < (iso ? 118 : 87)) { rejected++; continue; }
    try {
      const identity = normalizeIdentifier(line.slice(iso ? 35 : 23, iso ? 47 : 35), iso ? "cpf" : "pis", true);
      valid++;
      const values = names.get(identity) ?? new Set<string>(); values.add(name); names.set(identity, values);
    } catch { rejected++; }
  }
  const unambiguous = Array.from(names.values()).filter((values) => values.size === 1).map((values) => [...values][0]);
  afd.push({ profile, type5: registrations.length, type6: lines.filter((line) => line[9] === "6").length, validWorkerRecords: valid, rejectedWorkerRecords: rejected, uniqueWorkerIdentities: names.size, conflictingNames: names.size - unambiguous.length, candidates: countCandidates(unambiguous) });
}
console.log(JSON.stringify({ mode: "read-only-local", rhEmployees: employees.length, defensePeople: people.length, defenseCandidates: countCandidates(people.map((person) => person.name)), afd, bindingsCreated: 0 }));
