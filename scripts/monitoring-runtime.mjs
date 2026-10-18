// Supervises only this checkout. Existing listeners/processes are never killed.
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireWorkerProcessLock } from "../lib/monitoring/ingestion/process-lock.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".monitoring-worker", "runtime");
const statusFile = resolve(directory, "status.json"); const logFile = resolve(directory, "events.jsonl");
const children = new Set(); let stopping = false;
let releaseSupervisor;
async function log(event, detail = {}) { const record = { at: new Date().toISOString(), event, ...detail }; if (await stat(logFile).then(info => info.size > 2 * 1024 * 1024).catch(() => false)) await rename(logFile, `${logFile}.previous`).catch(() => {}); const handle = await open(logFile, "a", 0o600); try { await handle.write(JSON.stringify(record) + "\n"); } finally { await handle.close(); } }
async function health(endpoint) { try { const result = await fetch(new URL("/api/health", endpoint), { redirect: "error", signal: AbortSignal.timeout(4000) }); return result.ok && (await result.json()).service === "administrativo-cd-rh"; } catch { return false; } }
async function occupied(host, port) { return new Promise(resolveOccupied => { const socket = connect({ host, port }); const finish = value => { socket.destroy(); resolveOccupied(value); }; socket.setTimeout(1500); socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.once("timeout", () => finish(true)); }); }
function launch(args, cwd = root, environment = {}) { const child = spawn(process.execPath, ["--import", pathToFileURL(resolve(root, "scripts/monitoring-runtime-child.mjs")).href, ...args], { cwd, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...environment } }); children.add(child); child.on("close", code => { children.delete(child); void log("child_exited", { pid: child.pid, code }); }); child.on("error", () => children.delete(child)); return child; }
function stop() { stopping = true; for (const child of children) child.kill(); }
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
 releaseSupervisor = await acquireWorkerProcessLock(directory);
 process.on("SIGINT", stop); process.on("SIGTERM", stop); await log("supervisor_started", { pid: process.pid });
 let worker; let server; let configurationVersion = "";
 while (!stopping) {
  try {
   const stopFile = resolve(directory, "stop.request");
   if (await stat(stopFile).then(() => true).catch(() => false)) { await unlink(stopFile); stop(); break; }
   const configFile = resolve(root, "monitoramento.local.json"); const envFile = resolve(root, ".env.local");
   const configText = await readFile(configFile, "utf8"); const config = JSON.parse(configText); const endpoint = new URL(config.endpoint);
   const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname); const port = Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
   const version = `${(await stat(configFile)).mtimeMs}:${(await stat(envFile)).mtimeMs}`;
   if (version !== configurationVersion && configurationVersion) { if (worker && children.has(worker)) worker.kill(); if (server && children.has(server)) server.kill(); await log("configuration_reload"); await delay(1500); }
   configurationVersion = version;
   const ready = await health(endpoint);
   if (!ready && local && ![...children].includes(server) && !(await occupied(endpoint.hostname === "[::1]" ? "::1" : endpoint.hostname, port))) {
    // Run only a validated production release. next dev can fork descendants beyond this supervisor's ownership.
    const releaseInfo = await readFile(resolve(directory, "active-release.json"), "utf8").then(JSON.parse).catch(() => null);
    const safeRelease = releaseInfo?.release && resolve(releaseInfo.release).startsWith(resolve(directory, "releases") + sep) ? resolve(releaseInfo.release) : root;
    const built = safeRelease !== root && await stat(resolve(safeRelease, ".next", "BUILD_ID")).then(() => true).catch(() => false);
    if (!built) throw new Error("VALIDATED_RUNTIME_BUILD_REQUIRED");
    server = launch(["--env-file=" + envFile, resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], safeRelease, { ALLOW_LOOPBACK_ORIGIN: "1", APP_ORIGIN: `http://localhost:${port}` });
    await log("local_server_started", { pid: server.pid, mode: "production", port });
   }
   if (ready && (!worker || !children.has(worker))) { worker = launch(["--env-file=" + envFile, "--experimental-strip-types", resolve(root, "scripts/monitoring-import.ts"), "--apply", "--watch"]); await log("worker_started", { pid: worker.pid }); }
   const state = { updatedAt: new Date().toISOString(), supervisorPid: process.pid, workerPid: worker && children.has(worker) ? worker.pid : null, serverPid: server && children.has(server) ? server.pid : null, apiReady: ready, endpointOrigin: endpoint.origin };
   const temporary = `${statusFile}.tmp`; await writeFile(temporary, JSON.stringify(state, null, 2)); await rename(temporary, statusFile);
  } catch (error) { const code = error.code || error.message; await log("runtime_retry", { code: typeof code === "string" && /^[A-Z_0-9]+$/.test(code) ? code : "RUNTIME_UNAVAILABLE" }); }
  if (!stopping) await delay(10000);
 }
} catch (error) { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : "RUNTIME_START_FAILED"); process.exitCode = 1; }
finally { stop(); await releaseSupervisor?.(); }
