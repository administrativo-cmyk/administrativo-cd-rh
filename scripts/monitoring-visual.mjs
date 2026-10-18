// Isolated visual harness. Uses synthetic data and a loopback-only Vite server.
// It never changes application authentication or connects to Supabase.
import { createRequire } from "node:module";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import tailwind from "@tailwindcss/postcss";

const requireVitest = createRequire(import.meta.resolve("vitest"));
const { createServer } = await import(pathToFileURL(requireVitest.resolve("vite")).href);
const root = process.cwd();
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "monitoring-visual-")));
const output = path.resolve("artifacts/monitoring-visual");
await mkdir(output, { recursive: true });
const employeeId = "30000000-0000-4000-8000-000000000001";
const profile = { id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Sintético", status_usuario: "APROVADO", papel_usuario: "RH", gestor_id: null, ultimo_acesso_em: null, created_at: "2026-10-17", updated_at: "2026-10-17" };
const filters = { start: "2026-10-17", end: "2026-10-17", query: "", unit: "", managerId: "", employeeId: "", group: "", schedule: "", quality: "", offset: 0, limit: 50 };
const snapshot = { rows: Array.from({ length: 6 }, (_, index) => ({ employeeId: employeeId.slice(0, -1) + (index + 1), name: ["Ana Sintética", "Bruno Exemplo", "Carla Fictícia", "Daniel Exemplo", "Eva Sintética", "Fernando Fictício"][index], employeeNumber: `FICT-00${index + 1}`, unit: "CD I", manager: "Gestor Sintético", managerId: "20000000-0000-4000-8000-000000000001", date: "2026-10-17", quality: ["complete", "partial", "pending", "excluded", "stale", "unavailable"][index], dirty: index === 4, computedAt: "2026-10-17T18:00:00Z", ruleVersion: "synthetic-test", summary: index === 2 ? null : { workedSeconds: 28800, outsideSeconds: index < 2 ? 1200 : null, cafeteriaSeconds: index === 0 ? 600 : null, lateSeconds: index === 0 ? 1200 : null } })), total: 6, people: 6, pending: 3, excluded: 1, totals: { workedSeconds: 57600, outsideSeconds: 2400, cafeteriaSeconds: 600, lateJourneys: 1, latenessAssessedJourneys: 1, assessedJourneys: 2, unknownSeconds: 1800 }, timezone: "America/Sao_Paulo", queriedAt: "2026-10-17T18:00:00Z", start: filters.start, end: filters.end };
const admin = { sources: [{ id: "defense-sintetico", kind: "defense-access", timezone: "America/Sao_Paulo", heartbeat_at: new Date().toISOString(), worker_state: "idle", last_success_at: new Date().toISOString() }], files: [], settings: [], bindings: [], employees: snapshot.rows.map((row) => ({ id: row.employeeId, name: row.name, employeeNumber: row.employeeNumber })), users: [{ id: profile.id, name: profile.nome_completo }], pending: [{ source_id: "defense-sintetico", identity_type: "defense", identity_value: "000123", name: "Ana Sintética" }], audit: [], jobs: { pending: 2, failed: 0 }, attempts: [] };
const detail = { results: [], events: [{ id: "fixture-event", timestamp: "2026-10-17T11:00:00Z", type: "access", device: "Entrada operação (sintética)", classification: "authorized", eligible: true, conflicted: false, provenance: [{ fileId: "arquivo-sintetico", line: 2, sheet: "Acessos", conflict: false }] }] };
const at = (time) => Date.parse(`2026-10-17T${time}:00-03:00`);
const interval = (start, end) => ({ start: at(start), end: at(end) });
const eligibility = { state: "eligible", policyIds: [], reasons: [] };
const metric = (milliseconds, intervals) => ({ milliseconds, quality: "complete", knownMs: 28800000, unknownMs: 0, coverageRatio: 1, intervals, eligibility });
detail.results.push({ date: "2026-10-17", dirty: false, computedAt: "2026-10-17T21:00:00Z", summary: snapshot.rows[0].summary, result: {
  personId: employeeId, operationalDate: "2026-10-17", ruleVersion: "synthetic-test", timezone: "America/Sao_Paulo",
  journey: { status: "complete", work: [interval("08:00", "12:00"), interval("13:00", "17:00")], rest: [interval("12:00", "13:00")], provisionalWork: [], firstEntry: at("08:00"), lastExit: at("17:00"), retainedPunchIds: [], issues: [] },
  workMs: 28800000, restMs: 3600000, insideOperationMs: 27600000,
  outsideOperation: metric(1200000, [interval("11:50", "12:00"), interval("13:00", "13:10")]),
  cafeteria: metric(600000, [interval("10:00", "10:10")]),
  outsideCd: { ...metric(null, []), quality: "unavailable", knownMs: 0, unknownMs: 28800000, coverageRatio: 0 },
  coffeeDuringWorkMs: 600000, cafeteriaObservedMs: 600000,
  cafeteriaVisits: [{ ...interval("10:00", "10:10"), entryEventId: "fixture-entry", exitEventId: "fixture-exit", workMs: 600000, coffeeMs: 600000, classification: "fromOperation", sequenceEventIds: [] }],
  outsideOperationEpisodes: [{ ...interval("11:50", "13:10"), kind: "departure", workMs: 1200000 }], betweenOperationExitAndPrincipalEntry: [],
  lateness: { quality: "complete", reason: null, totalMs: 1200000, excessMs: 300000, over15Minutes: true, operationalMonth: "2026-10", eligibility },
  location: [{ ...interval("08:00", "11:50"), area: "operation", state: "inside", evidenceEventIds: [] }, { ...interval("11:50", "13:10"), area: "operation", state: "outside", evidenceEventIds: [] }, { ...interval("13:10", "17:00"), area: "operation", state: "inside", evidenceEventIds: [] }],
  suppressions: [], issues: [{ code: "INCOMPLETE_AREA_MAPPING", eventIds: [] }],
} });
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Teste visual sintético</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {MonitoringApp} from '@/components/monitoring/monitoring-app';import '@/app/globals.css';createRoot(document.getElementById('root')!).render(<MonitoringApp profile={${JSON.stringify(profile)}} initialFilters={${JSON.stringify(filters)}} initialSnapshot={${JSON.stringify(snapshot)}} />);`);
const resolveReact = createRequire(import.meta.resolve("react"));
const server = await createServer({
  root: temporary, configFile: false, logLevel: "error",
  resolve: { alias: { "@": root, react: path.dirname(resolveReact.resolve("react/package.json")), "react-dom": path.dirname(resolveReact.resolve("react-dom/package.json")) } },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
  plugins: [{ name: "next-harness", enforce: "pre", resolveId(id) { if (["next/link", "next/image", "next/navigation"].includes(id)) return `\0harness:${id}`; }, load(id) {
    if (id === "\0harness:next/navigation") return "export const useRouter=()=>({replace(){},refresh(){}})";
    if (id === "\0harness:next/link") return "import React from 'react';export default function Link(props){return React.createElement('a',props)}";
    if (id === "\0harness:next/image") return "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}";
  }, configureServer(instance) {
    instance.middlewares.use((request, response, next) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (!url.pathname.startsWith("/api/monitoring")) return next();
      response.setHeader("Content-Type", "application/json");
      if (url.pathname.endsWith("/photo")) { response.statusCode = 404; return response.end("{}"); }
      if (url.pathname.endsWith("/config")) { response.statusCode = 409; return response.end(JSON.stringify({ error: "Conflito sintético: rascunho preservado." })); }
      response.end(JSON.stringify(url.pathname.endsWith("/admin") ? admin : url.pathname.endsWith("/detail") ? detail : snapshot));
    });
  } }],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Monitoramento do CD", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.width}-consulta.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.getByRole("button", { name: "Detalhes de Ana Sintética", exact: true }).click();
    await page.getByRole("heading", { name: "Jornada de 17/10/2026", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.width}-detalhe.png`), fullPage: false, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Importação", exact: true }).click();
    await page.getByRole("heading", { name: "Recálculo automático", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.width}-importacao.png`), fullPage: true });
    await page.getByRole("button", { name: "Conciliação", exact: true }).click();
    await page.getByRole("button", { name: /Ana Sintética.*Conferir vínculo/ }).click();
    const form = page.getByRole("form", { name: "Vincular identidade" });
    await form.getByLabel("Colaborador RH").selectOption(employeeId);
    await form.getByLabel("Evidência do vínculo").fill("Evidência sintética de teste");
    await form.getByRole("button", { name: "Salvar vínculo" }).click();
    await page.getByRole("alert").getByText("Conflito sintético", { exact: false }).waitFor();
    const preserved = await form.getByLabel("Evidência do vínculo").inputValue();
    await page.screenshot({ path: path.join(output, `${viewport.width}-conciliacao.png`), fullPage: true });
    await page.getByRole("button", { name: "Configuração", exact: true }).click();
    await page.getByRole("combobox", { name: "Configuração", exact: true }).selectOption("user_link");
    await page.screenshot({ path: path.join(output, `${viewport.width}-configuracao.png`), fullPage: true });
    results.push({ ...viewport, bodyOverflow: overflow, preservedDraft: preserved === "Evidência sintética de teste", pageErrors: errors });
    await page.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  if (results.some((result) => result.bodyOverflow || !result.preservedDraft || result.pageErrors.length)) throw new Error("Visual harness found a regression; inspect artifacts/monitoring-visual/results.json");
  console.log(JSON.stringify({ syntheticOnly: true, output, results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
  const allowed = await realpath(tmpdir()) + path.sep;
  if (path.resolve(temporary).startsWith(allowed) && path.basename(temporary).startsWith("monitoring-visual-")) await rm(temporary, { recursive: true, force: true });
}
