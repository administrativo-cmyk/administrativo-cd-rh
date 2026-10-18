import { mkdir, readFile, realpath, stat, writeFile, rename, copyFile, unlink, lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, parse } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateConfig } from "../lib/monitoring/ingestion/worker.ts";

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export function parseSourceArgs(argv) {
 const result = {};
 for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (["--apply", "--help", "--allow-external-root"].includes(key)) { result[key.slice(2)] = true; continue; }
  if (!["--id", "--root", "--photo-root", "--kind", "--namespace", "--timezone", "--afd-profile", "--encoding", "--config"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("SOURCE_ARGUMENT_INVALID");
  result[key.slice(2)] = argv[++i];
 }
 if (!result.help && (!identifier.test(result.id || "") || !result.root)) throw new Error("SOURCE_ID_AND_ROOT_REQUIRED");
 return result;
}
export function allowlistWithSource(text, id) {
 if (!identifier.test(id)) throw new Error("SOURCE_ID_INVALID");
 const lines = text.split(/\r?\n/); const matches = lines.map((line, index) => /^\s*(?:export\s+)?MONITORING_INGEST_SOURCE_IDS\s*=/.test(line) ? index : -1).filter(index => index >= 0);
 if (matches.length > 1) throw new Error("SOURCE_ALLOWLIST_DUPLICATED");
 const index = matches[0]; const old = index === undefined ? "" : lines[index].slice(lines[index].indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
 const values = old.split(",").map(value => value.trim()).filter(Boolean); if (values.some(value => !identifier.test(value))) throw new Error("SOURCE_ALLOWLIST_INVALID");
 const next = `MONITORING_INGEST_SOURCE_IDS=${[...new Set([...values, id])].join(",")}`;
 if (index === undefined) lines.push(next); else lines[index] = next;
 return lines.join("\n");
}
async function localDirectory(base, value, allowExternal) {
 const directory = await realpath(resolve(base, value));
 if (!(await stat(directory)).isDirectory() || directory === parse(directory).root || directory === base) throw new Error("SOURCE_ROOT_TOO_BROAD");
 const within = relative(base, directory); if (!allowExternal && (within.startsWith("..") || isAbsolute(within))) throw new Error("SOURCE_EXTERNAL_ROOT_REQUIRES_EXPLICIT_FLAG");
 return directory;
}
async function atomicWrite(file, value) { const temporary = `${file}.${randomUUID()}.tmp`; try { await writeFile(temporary, value, { flag: "wx", mode: 0o600 }); await rename(temporary, file); } finally { await unlink(temporary).catch(() => {}); } }
async function privateLocalFile(base, file) {
 const resolved = await realpath(file); const fromBase = relative(base, resolved);
 if (fromBase.startsWith("..") || isAbsolute(fromBase) || (await lstat(file)).isSymbolicLink()) throw new Error("SOURCE_CONFIG_EXTERNAL_LINK");
 return file;
}
export async function registerSource(options, project = process.cwd()) {
 const base = await realpath(project); const configFile = resolve(base, options.config || "monitoramento.local.json");
 const relativeConfig = relative(base, configFile); if (relativeConfig.startsWith("..") || isAbsolute(relativeConfig) || !configFile.endsWith(".json")) throw new Error("SOURCE_CONFIG_OUTSIDE_PROJECT");
 await privateLocalFile(base, configFile);
 const original = await readFile(configFile, "utf8"); const config = JSON.parse(original); const existing = config.sources.find(source => source.id === options.id);
 if (!existing && (!options.kind || !options.namespace)) throw new Error("SOURCE_KIND_AND_NAMESPACE_REQUIRED");
 const root = await localDirectory(base, options.root, options["allow-external-root"]);
 const photoRoot = options["photo-root"] ? await localDirectory(base, options["photo-root"], options["allow-external-root"]) : existing?.photoRoot;
 const source = { ...existing, id: options.id, kind: options.kind || existing?.kind, root, timeZone: options.timezone || existing?.timeZone || "America/Sao_Paulo", identityNamespace: options.namespace || existing?.identityNamespace || existing?.id,
  ...(photoRoot ? { photoRoot } : {}), ...(options["afd-profile"] ? { afdProfile: options["afd-profile"] } : {}), ...(options.encoding ? { encoding: options.encoding } : {}), recursive: existing?.recursive ?? false, enabled: existing?.enabled ?? true, sourceIdentityConfirmed: existing?.sourceIdentityConfirmed ?? false };
 if (existing && (["kind", "timeZone"].some(key => source[key] !== existing[key]) || source.identityNamespace !== (existing.identityNamespace || existing.id))) throw new Error("SOURCE_IDENTITY_CHANGE_REQUIRES_NEW_SOURCE");
 if (source.kind === "afd" && !source.afdProfile) throw new Error("SOURCE_AFD_PROFILE_REQUIRED");
 config.sources = [...config.sources.filter(item => item.id !== source.id), source]; validateConfig(structuredClone(config), dirname(configFile));
 const envFile = await privateLocalFile(base, resolve(base, ".env.local")); const originalEnv = await readFile(envFile, "utf8"); const nextEnv = allowlistWithSource(originalEnv, source.id);
 const summary = { sourceId: source.id, root, photoRoot: photoRoot || null, kind: source.kind, apply: Boolean(options.apply), note: "O cadastro remoto deve usar o mesmo ID. O servidor precisa recarregar a allowlist; hospedagem remota requer atualizar a mesma variável na hospedagem." };
 if (!options.apply) return summary;
 const backup = resolve(base, ".monitoring-worker", "configuration-backups", `${Date.now()}-${randomUUID()}`); await mkdir(backup, { recursive: true, mode: 0o700 });
 await copyFile(configFile, resolve(backup, "monitoramento.local.json")); await copyFile(envFile, resolve(backup, "env.local.private"));
 const lock = resolve(base, ".monitoring-worker", "configuration.lock"); await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
 try {
  if (await readFile(configFile, "utf8") !== original || await readFile(envFile, "utf8") !== originalEnv) throw new Error("SOURCE_CONFIG_CHANGED_RETRY");
  await atomicWrite(envFile, nextEnv);
  try { await atomicWrite(configFile, JSON.stringify(config, null, 2) + "\n"); } catch (error) { await atomicWrite(envFile, originalEnv); throw error; }
 } finally { await unlink(lock); }
 return { ...summary, backup };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try { const options = parseSourceArgs(process.argv.slice(2)); console.log(options.help ? "Registrar pasta local: node --experimental-strip-types scripts/monitoring-register-source.mjs --id ID --root PASTA [--kind afd|defense-access|defense-person --namespace NOME --afd-profile legacy|iso] [--photo-root PASTA] [--apply]. Padrão: prévia. Não concede acesso ao disco por meio do navegador." : JSON.stringify(await registerSource(options), null, 2)); }
 catch (error) { console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error.message) ? error.message : "SOURCE_REGISTRATION_FAILED" })); process.exitCode = 1; }
}
