import { ImportError } from "./validation.ts";
import { httpBodyLimitBytes } from "../payload-limits.ts";
import type { IngestBatch, IngestionSource, ParsedImport } from "./types.ts";

export function batchesFor(parsed: ParsedImport, source: IngestionSource, relativePath: string, batchSize = 500): IngestBatch[] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new ImportError("INVALID_BATCH_SIZE");
  const { id, kind, timeZone, identityNamespace, sourceIdentityConfirmed, declaredCoverage } = source;
  const makeBatch = (occurrences: ParsedImport["occurrences"], index: number, totalBatches: number): IngestBatch => ({
    protocolVersion: 1,
    source: { id, kind, timeZone, identityNamespace, sourceIdentityConfirmed, declaredCoverage },
    file: { sha256: parsed.sha256, byteLength: parsed.byteLength, parserVersion: parsed.parserVersion, relativePath, issues: parsed.issues, observedRange: parsed.observedRange, metadata: parsed.metadata },
    batch: { index, final: index === totalBatches - 1, totalRows: parsed.totalRows, occurrenceCount: parsed.occurrences.length, totalBatches },
    occurrences,
  });
  // Reserve the longest possible counters and `final:false` before packing.
  // Occurrence keys/hashes and file identity stay unchanged across retries.
  const maximumBatches = Math.max(1, parsed.occurrences.length);
  const envelope = makeBatch([], maximumBatches - 1, maximumBatches); envelope.batch.final = false;
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (envelopeBytes > httpBodyLimitBytes) throw new ImportError("INGEST_METADATA_TOO_LARGE");
  const groups: ParsedImport["occurrences"][] = []; let current: ParsedImport["occurrences"] = []; let currentBytes = envelopeBytes;
  for (const occurrence of parsed.occurrences) {
    const bytes = Buffer.byteLength(JSON.stringify(occurrence), "utf8");
    if (envelopeBytes + bytes > httpBodyLimitBytes) throw new ImportError("INGEST_OCCURRENCE_TOO_LARGE");
    if (current.length >= batchSize || currentBytes + bytes + (current.length ? 1 : 0) > httpBodyLimitBytes) {
      groups.push(current); current = []; currentBytes = envelopeBytes;
    }
    currentBytes += bytes + (current.length ? 1 : 0); current.push(occurrence);
  }
  if (current.length || !groups.length) groups.push(current);
  return groups.map((occurrences, index) => makeBatch(occurrences, index, groups.length));
}
