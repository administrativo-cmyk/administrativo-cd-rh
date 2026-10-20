import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareArchive, readArchiveHistory, reconcileArchive, restoreArchiveOriginals, verifyArchive, type ArchiveConfiguration, type ArchiveHistoryFilter } from "../lib/monitoring/archive/local.ts";

const [command, ...args] = process.argv.slice(2);
function option(name: string) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
const output = option("--output"); const configPath = option("--config"); const archive = option("--archive");
try {
  const allowed = ["--output", "--config", "--archive", "--from", "--to", "--source", "--identity-type", "--identity"];
  if (args.some((arg, index) => index % 2 === 0 && !allowed.includes(arg)) || args.length % 2
    || new Set(args.filter((_, index) => index % 2 === 0)).size !== args.length / 2) throw new Error("ARCHIVE_ARGUMENTS_INVALID");
  let result: unknown;
  if (command === "prepare" && output && configPath && !archive) {
    const config = JSON.parse(await readFile(path.resolve(configPath), "utf8")) as ArchiveConfiguration;
    const prepared = await prepareArchive(config, output, message => console.log(message));
    result = { output: path.resolve(output), ...prepared.receipt, databaseChanged: false, storageUploaded: false };
  } else if (command === "verify" && archive && !configPath) result = await verifyArchive(archive, "manifest.json", message => console.log(message));
  else if (command === "reconcile" && archive && configPath) {
    const config = JSON.parse(await readFile(path.resolve(configPath), "utf8")) as ArchiveConfiguration;
    result = await reconcileArchive(archive, config);
  } else if (command === "restore-originals" && archive && output && !configPath) result = await restoreArchiveOriginals(archive, output);
  else if (command === "history" && archive && output) {
    const filter = { sourceId: option("--source"), identityType: option("--identity-type"), identity: option("--identity"), from: option("--from"), to: option("--to") } as ArchiveHistoryFilter;
    result = { rows: await readArchiveHistory(archive, filter), databaseChanged: false };
  } else throw new Error("ARCHIVE_ARGUMENTS_INVALID");
  if (output && !["prepare", "restore-originals"].includes(command)) await writeFile(path.resolve(output), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(command === "history" ? JSON.stringify({ output: path.resolve(output!), databaseChanged: false }) : JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error && /^ARCHIVE_[A-Z_]+$/.test(error.message) ? error.message : "ARCHIVE_PREPARATION_FAILED");
  process.exitCode = 1;
}
