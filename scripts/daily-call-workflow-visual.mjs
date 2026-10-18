// Synthetic, loopback-only UI verification. No authentication bypass or remote database.
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
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "daily-call-visual-")));
const output = path.resolve("output/playwright/chamada");
await mkdir(output, { recursive: true });
const date = "2026-10-16";
const managerId = "20000000-0000-4000-8000-000000000001";
const profile = { id: "10000000-0000-4000-8000-000000000001", nome_completo: "Usuário Sintético", status_usuario: "APROVADO", papel_usuario: "GESTOR", gestor_id: managerId, ultimo_acesso_em: null, created_at: date, updated_at: date };
const variants = [
  { name: "Ana Sintética", status: "P", origin: "punch", state: "present", balanceMinutes: 600 },
  { name: "Bruno Sintético", status: "I", origin: "automatic_absence", state: "automatic_absence", balanceMinutes: 480 },
  { name: "Carla Sintética", status: null, origin: null, state: "pending_manager", balanceMinutes: 481 },
  { name: "Daniel Sintético", status: null, origin: null, state: "blocked", balanceMinutes: null },
  { name: "Eva Sintética", status: "F", origin: "manual", state: "manual", balanceMinutes: 120 },
];
const rows = variants.map((item, index) => ({ ...item, employeeId: `30000000-0000-4000-8000-00000000000${index + 1}`, employeeNumber: `FICT-00${index + 1}`, managerId, managerName: "Gestor Sintético", date, blockers: item.state === "blocked" ? ["PUNCH_COVERAGE_UNCONFIRMED", "BALANCE_UNKNOWN"] : [], updatedAt: item.status ? "2026-10-17T12:00:00Z" : null, decisionVersion: "synthetic-version" }));
const counts = { total: 5, present: 1, automaticAbsence: 1, manual: 1, pending: 1, blocked: 1 };
const queue = { revision: "synthetic-revision", start: date, end: date, rows, counts, days: [{ ...counts, date, managerId, managerName: "Gestor Sintético", closedAt: null }] };
const snapshot = { date, startDate: "2026-10-01", endDate: "2026-10-31", loadedAt: "2026-10-17T12:00:00Z", employees: rows.map((row) => ({ id: row.employeeNumber, databaseId: row.employeeId, name: row.name, unit: "CD I", manager: row.managerName, department: "Operação", role: "Auxiliar", situation: "Ativo", admissionDate: "2025-01-01", plannedVacation: "—", bankDays: null, bankHours: null, realBank: null, attendance: row.status ? { [date]: row.status } : {}, attendanceSources: row.origin ? { [date]: row.origin } : {}, attendanceVersions: row.updatedAt ? { [date]: row.updatedAt } : {}, observations: {} })) };
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Chamada — teste sintético</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {DailyCallApp} from '@/components/daily-call-app';import '@/app/globals.css';createRoot(document.getElementById('root')!).render(<DailyCallApp profile={${JSON.stringify(profile)}} initialDate="${date}" initialSnapshot={${JSON.stringify(snapshot)}} />);`);
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
  }, configureServer(instance) { instance.middlewares.use((request, response, next) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return next();
    response.setHeader("Content-Type", "application/json");
    if (url.pathname.includes("/photo")) { response.statusCode = 404; return response.end("{}"); }
    if (request.method === "POST") { response.statusCode = 409; return response.end(JSON.stringify({ error: "Conflito sintético: atualize a revisão." })); }
    response.end(JSON.stringify(url.pathname.endsWith("/pending") ? { ...queue, start: url.searchParams.get("start"), end: url.searchParams.get("end") } : snapshot));
  }); } }],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Revisar 16/10/2026 de Gestor Sintético" }).waitFor();
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: path.join(output, `${viewport.width}-fila.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Revisar 16/10/2026 de Gestor Sintético" }).click();
    await page.getByRole("button", { name: "Revisar lançamento de Carla Sintética" }).click();
    const form = page.getByRole("form", { name: "Decisão de Carla Sintética" });
    await form.getByRole("combobox", { name: "Ocorrência" }).selectOption("G");
    await form.getByRole("textbox", { name: "Justificativa da decisão" }).fill("Compensação sintética conferida");
    await form.getByRole("button", { name: "Salvar decisão" }).click();
    await page.getByRole("alert").getByText("Conflito sintético", { exact: false }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Salvar decisão" && !button.disabled));
    const preservedDraft = await form.getByRole("textbox", { name: "Justificativa da decisão" }).inputValue() === "Compensação sintética conferida";
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${viewport.width}-revisao.png`), fullPage: false, animations: "disabled" });
    const drawerOverflow = await page.getByRole("dialog").evaluate((element) => element.scrollWidth > element.clientWidth);
    results.push({ ...viewport, bodyOverflow, drawerOverflow, preservedDraft, pageErrors: errors });
    await page.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  if (results.some((result) => result.bodyOverflow || result.drawerOverflow || !result.preservedDraft || result.pageErrors.length)) throw new Error("Inspect output/playwright/chamada/results.json");
  console.log(JSON.stringify({ syntheticOnly: true, output, results }, null, 2));
} finally {
  await browser?.close(); await server.close();
  const allowed = await realpath(tmpdir()) + path.sep;
  if (path.resolve(temporary).startsWith(allowed) && path.basename(temporary).startsWith("daily-call-visual-")) await rm(temporary, { recursive: true, force: true });
}
