import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHttpTransport } from "../lib/monitoring/ingestion/transport.ts";
import { readWorkerConfig, scanSources, watchSources } from "../lib/monitoring/ingestion/worker.ts";
import { ImportError, errorCode } from "../lib/monitoring/ingestion/validation.ts";
import { acquireWorkerProcessLock } from "../lib/monitoring/ingestion/process-lock.ts";

export function parseMonitoringArgs(argv: string[]) {
  const args: { config: string; apply: boolean; watch: boolean; reprocess: boolean; sourceId?: string; from?: string; to?: string; help: boolean } = { config: "monitoramento.local.json", apply: false, watch: false, reprocess: false, help: false };
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help") args.help = true;
    else if (argument === "--apply") args.apply = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--watch") args.watch = true;
    else if (argument === "--once" || argument === "--resume") { /* A one-shot scan resumes incomplete files by default. */ }
    else if (argument === "--reprocess") args.reprocess = true;
    else if (["--config", "--source", "--from", "--to"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new ImportError("CLI_OPTION_VALUE_MISSING");
      if (argument === "--config") args.config = value;
      else if (argument === "--source") args.sourceId = value;
      else if (argument === "--from") args.from = value;
      else args.to = value;
    } else throw new ImportError("CLI_UNKNOWN_OPTION");
  }
  if (args.apply && dryRun) throw new ImportError("CLI_APPLY_DRY_RUN_CONFLICT");
  for (const date of [args.from, args.to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new ImportError("CLI_INVALID_DATE");
  if (args.from && args.to && args.from > args.to) throw new ImportError("CLI_INVALID_DATE_RANGE");
  return args;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseMonitoringArgs(argv);
  if (args.help) {
    console.log("Monitoramento CD: --config arquivo.json [--dry-run|--apply] [--once|--watch] [--resume] [--reprocess] [--source id] [--from YYYY-MM-DD] [--to YYYY-MM-DD]. Padrão: dry-run, execução única. Token somente por variável de ambiente.");
    return;
  }
  const config = await readWorkerConfig(resolve(args.config));
  const transport = args.apply ? createHttpTransport(config.endpoint ?? "", process.env[config.tokenEnvironmentVariable ?? "MONITORING_INGEST_TOKEN"] ?? "") : undefined;
  const release = await acquireWorkerProcessLock(config.stateDirectory);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const options = { apply: args.apply, reprocess: args.reprocess, sourceId: args.sourceId, from: args.from, to: args.to, signal: abort.signal };
  try {
    if (args.watch) await watchSources(config, { ...options, onProgress: summary => console.log(JSON.stringify({ event: "source_progress", ...summary })) }, transport);
    else {
      const summaries = await scanSources(config, options, transport);
      console.log(JSON.stringify({ event: "scan_complete", dryRun: !args.apply, sources: summaries }, null, 2));
      if (summaries.some(summary => summary.failedFiles || summary.rejectedRows)) process.exitCode = 2;
    }
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ event: "worker_error", code: errorCode(error) })); process.exitCode = 1; });
}
