// Synthetic browser verification of the actual export component and downloaded XLSX.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import tailwind from "@tailwindcss/postcss";

const root = process.cwd();
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "daily-call-excel-")));
const output = path.resolve("output/playwright/chamada-excel");
await mkdir(output, { recursive: true });
const requireVitest = createRequire(import.meta.resolve("vitest"));
const { createServer } = await import(pathToFileURL(requireVitest.resolve("vite")).href);
const requireReact = createRequire(import.meta.resolve("react"));
const employee = { id: "00042", databaseId: "00000000-0000-4000-8000-000000000042", name: "Ana de Souza Sintética", unit: "CD I", manager: "Gestor Sintético", department: "Operação", role: "Auxiliar", situation: "Ativo", admissionDate: "2025-01-01", plannedVacation: "—", bankDays: null, bankHours: null, realBank: null, attendance: { "2026-10-01": "P", "2026-10-03": "F" }, observations: {} };
const input = { employees: [employee, { ...employee, id: "00043", databaseId: "00000000-0000-4000-8000-000000000043", name: "Bruno Sintético", bankDays: 0, bankHours: "0:00", realBank: undefined }], start: "2026-10-01", end: "2026-10-03" };
const days = ["2026-10-01", "2026-10-02", "2026-10-03"].map(date => ({ date, bankDay: null, correctionVersion: null, displayMarks: date === "2026-10-01" ? [{ at: Date.parse(`${date}T22:00:00-03:00`) }, { at: null, role: "breakStart" }, { at: Date.parse("2026-10-02T01:00:00-03:00"), origin: "turnstile", role: "breakEnd" }, { at: Date.parse("2026-10-02T06:20:00-03:00") }] : [] }));
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Exportação da Chamada</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {DailyCallExcelButton} from '@/components/daily-call-excel-button';import {PeriodGrid} from '@/components/period-grid';import {TooltipProvider} from '@/components/ui/tooltip';import '@/app/globals.css';const input=${JSON.stringify(input)};createRoot(document.getElementById('root')).render(<TooltipProvider><main className="space-y-4 p-4"><header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">Chamada Diária</h1><DailyCallExcelButton input={input} disabled={false}/></header><PeriodGrid employees={input.employees} startDate={input.start} endDate={input.end} onSelect={()=>{}}/></main></TooltipProvider>);`);
const server = await createServer({
  root: temporary, configFile: false, logLevel: "error",
  resolve: { alias: { "@": root, react: path.dirname(requireReact.resolve("react/package.json")), "react-dom": path.dirname(requireReact.resolve("react-dom/package.json")) } },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
  plugins: [{ name: "synthetic-history", enforce: "pre", resolveId(id) { if (["next/image", "next/link", "next/navigation"].includes(id)) return `\0harness:${id}`; }, load(id) {
    if (id === "\0harness:next/navigation") return "export const useRouter=()=>({replace(){},refresh(){}})";
    if (id === "\0harness:next/link") return "import React from 'react';export default function Link(props){return React.createElement('a',props)}";
    if (id === "\0harness:next/image") return "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}";
  }, configureServer(instance) { instance.middlewares.use((request, response, next) => {
    if (!request.url.startsWith("/api/")) return next();
    response.setHeader("Content-Type", "application/json");
    if (request.url.includes("/photo")) { response.statusCode = 404; return response.end("{}"); }
    response.end(JSON.stringify({ days, bank: null, canEdit: false, correctionHistory: [] }));
  }); } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const results = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: "networkidle" });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Exportar Excel" }).click()]);
    const downloaded = path.join(output, "chamada-sintetica.xlsx");
    await download.saveAs(downloaded);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(downloaded));
    const sheet = workbook.worksheets[0];
    if (sheet.getCell("A5").value !== "00042" || sheet.getCell("B7").value !== "Bruno Sintético" || sheet.getCell("H6").text !== "22:00\n--:--\n01:00 S T\n06:20 S") throw new Error("BROWSER_XLSX_MISMATCH");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(output, `export-${width}.png`), fullPage: true });
    results.push({ width, downloaded: download.suggestedFilename(), overflow, errors });
    await page.close();
  }
  console.log(JSON.stringify({ syntheticOnly: true, results }));
  if (results.some(result => result.overflow || result.errors.length)) throw new Error("Inspect browser output");
} finally {
  await browser?.close(); await server.close();
  const resolved = await realpath(temporary), allowed = await realpath(tmpdir());
  if (resolved.startsWith(allowed + path.sep) && path.basename(resolved).startsWith("daily-call-excel-")) await rm(resolved, { recursive: true, force: true });
}
