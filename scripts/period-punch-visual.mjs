// Loopback-only preview of the real period grid with synthetic night punches.
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
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "period-punch-visual-")));
const output = path.resolve("output/playwright/period-punch");
await mkdir(output, { recursive: true });
const id = "30000000-0000-4000-8000-000000000001";
const at = value => Date.parse(`${value}:00-03:00`);
const marks = ["2026-09-25T18:56", "2026-09-25T20:23", "2026-09-25T21:23", "2026-09-26T07:01"];
const bankDay = punches => ({ state: "pending", reason: "Horário padrão precisa ser confirmado", expectedMinutes: null, workedMinutes: null, deltaMinutes: null,
  punches: punches.map((value, index) => ({ id: `synthetic-${value}-${index}`, at: at(value), sourceId: "synthetic-clock" })), slots: [], missingRole: null, suggestions: [], suppressedIds: [] });
const response = { days: [
  { date: "2026-09-25", correctionVersion: null, bankDay: bankDay(marks.slice(0, 3)), displayMarks: marks.map(value => ({ at: at(value) })) },
  { date: "2026-09-26", correctionVersion: null, bankDay: bankDay(marks.slice(3)), displayMarks: [] },
], bank: null, canEdit: false, correctionHistory: [] };
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Batidas 12x36 — teste sintético</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {PeriodGrid} from '@/components/period-grid';import {TooltipProvider} from '@/components/ui/tooltip';import {initialEmployees} from '@/lib/mock-daily-call';import '@/app/globals.css';const employee={...initialEmployees[0],databaseId:'${id}',name:'Pessoa 12x36 sintética'};createRoot(document.getElementById('root')).render(<TooltipProvider><main className="max-w-full p-4"><h1 className="mb-4 text-lg font-semibold">Jornada noturna — exemplo sintético</h1><PeriodGrid employees={[employee]} startDate="2026-09-25" endDate="2026-10-01" onSelect={()=>{}} columnsCollapsed/></main></TooltipProvider>);`);
const resolveReact = createRequire(import.meta.resolve("react"));
const server = await createServer({
  root: temporary, configFile: false, logLevel: "error",
  resolve: { alias: { "@": root, react: path.dirname(resolveReact.resolve("react/package.json")), "react-dom": path.dirname(resolveReact.resolve("react-dom/package.json")) } },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
  plugins: [{ name: "period-punch-fixture", enforce: "pre", resolveId(id) { if (id === "next/image") return "\0fixture-image"; },
    load(id) { if (id === "\0fixture-image") return "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}"; },
    configureServer(instance) { instance.middlewares.use((request, result, next) => {
      if (!request.url.startsWith("/api/")) return next();
      result.setHeader("Content-Type", "application/json");
      if (request.url.includes("/photo")) { result.statusCode = 404; return result.end("{}"); }
      result.end(JSON.stringify(response));
    }); } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const results = [];
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Expandir batidas de Pessoa 12x36 sintética" }).click();
    const row = page.getByRole("row", { name: "Batidas de Pessoa 12x36 sintética" });
    await row.getByText("07:01 S", { exact: true }).waitFor();
    const entry = row.locator('[data-punch-date="2026-09-25"]');
    const next = row.locator('[data-punch-date="2026-09-26"]');
    const times = await entry.locator("time").allTextContents();
    if (JSON.stringify(times) !== JSON.stringify(["18:56", "20:23", "21:23", "07:01 S"]) || await next.locator("time").count()) throw new Error("PUNCH_ALIGNMENT_FAILED");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const clipped = await entry.locator("time").evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth));
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true, animations: "disabled" });
    results.push({ viewport, times, overflow, clipped, errors });
    await page.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.overflow || result.clipped || result.errors.length)) throw new Error("VISUAL_CHECK_FAILED");
} finally {
  await browser?.close(); await server.close();
  const allowed = await realpath(tmpdir()) + path.sep;
  if (path.resolve(temporary).startsWith(allowed) && path.basename(temporary).startsWith("period-punch-visual-")) await rm(temporary, { recursive: true, force: true });
}
