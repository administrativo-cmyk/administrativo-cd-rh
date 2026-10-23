// Synthetic, loopback-only preview of the actual React components. No database.
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
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "employee-numbers-visual-")));
const output = path.resolve("output/playwright/employee-numbers");
await mkdir(output, { recursive: true });
const id = "11111111-1111-4111-8111-111111111111", version = "2026-10-23T12:00:00Z";
const profile = { id, nome_completo: "Conta sintética", papel_usuario: "ADMIN", status_usuario: "APROVADO", gestor_id: null, ultimo_acesso_em: null, created_at: version, updated_at: version };
const employee = { id, employeeNumber: "52797", additionalEmployeeNumbers: ["46293"], name: "Pessoa Ágata Sintética", unitId: id, managerId: null, department: null, role: null, situation: "ATIVO", category: null, admissionDate: "2026-01-01", movement: null, workdayHours: 8, observation: null, cpf: null, pis: null, terminationDate: null, situationFrom: null, expectedReturnDate: null, activeInSystem: true, createdAt: version, updatedAt: version };
const snapshot = { entity: "employee", datasetVersion: "synthetic-v1", total: 1, rows: [employee], options: { units: [{ id, code: "CD I", name: "Unidade sintética", active: true }], managers: [], employees: [] }, permissions: { canManageRegisters: true, canApproveVacation: true, canProposeVacation: true } };
const preview = { id, kind: "clock", updatedAt: version, expiresAt: version, metadata: { fileName: "synthetic.csv", sha256: "a".repeat(64) }, rows: [{ line: 2, input: { employeeNumber: "99999", name: employee.name, cpf: "52998224725" }, employeeId: null, employeeName: null, employeeNumber: null, errors: ["MATRICULA_NAO_ENCONTRADA", "MATRICULA_DIVERGENTE_MESMO_NOME"], state: "blocked", result: null, nameCandidates: [{ id, name: employee.name, employeeNumber: "52797", additionalEmployeeNumbers: ["46293"] }] }] };
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Matrículas — teste sintético</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {AdministrationApp} from '@/components/administration/administration-app';import {ImportWizard} from '@/components/monitoring/import-wizard';import '@/app/globals.css';createRoot(document.getElementById('root')).render(<><AdministrationApp profile={${JSON.stringify(profile)}} entity="employee"/><main className="p-4"><ImportWizard kind="clock" today="2026-10-23" sources={[{id:'synthetic-clock',kind:'afd'}]} onApplied={()=>{}}/></main></>);`);
const resolveReact = createRequire(import.meta.resolve("react"));
const server = await createServer({
  root: temporary, configFile: false, logLevel: "error",
  resolve: { alias: { "@": root, react: path.dirname(resolveReact.resolve("react/package.json")), "react-dom": path.dirname(resolveReact.resolve("react-dom/package.json")) } },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
  plugins: [{ name: "numbers-harness", enforce: "pre", resolveId(id) { if (id.replaceAll("\\", "/").endsWith("/components/app-shell")) return "\0harness:@/components/app-shell"; if (["next/link", "next/image", "next/navigation"].includes(id)) return `\0harness:${id}`; }, load(id) {
    if (id === "\0harness:next/link") return "import React from 'react';export default function Link(props){return React.createElement('a',props)}";
    if (id === "\0harness:next/image") return "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}";
    if (id === "\0harness:next/navigation") return "export const useRouter=()=>({replace(){},refresh(){}});export const usePathname=()=>'/administracao/colaboradores';export const useSearchParams=()=>new URLSearchParams();";
    if (id === "\0harness:@/components/app-shell") return "import React from 'react';export function AppShell({children}){return React.createElement('main',{className:'space-y-4 p-4'},children)}";
  }, configureServer(instance) { instance.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/api/")) return next();
    response.setHeader("Content-Type", "application/json");
    if (request.url.includes("/photo")) { response.statusCode = 404; return response.end("{}"); }
    let body = ""; for await (const chunk of request) body += chunk;
    if (request.url.includes("clock-register")) return response.end(JSON.stringify(body.includes("inspect") ? { sheets: ["CSV"], selectedSheet: "CSV", headers: ["Matrícula", "Nome", "CPF"], sample: [{ line: 2, cells: ["99999", employee.name, "52998224725"] }], rowCount: 1 } : preview));
    const input = JSON.parse(body || "{}");
    return response.end(JSON.stringify(input.action === "save" ? { id, record: employee } : snapshot));
  }); } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Editar ${employee.name}` }).click();
    const dialog = page.getByRole("dialog");
    if (await dialog.getByLabel("Outras matrículas (uma por linha)").inputValue() !== "46293") throw new Error("ALIAS_NOT_LOADED");
    await page.screenshot({ path: path.join(output, `${viewport.width}-editor.png`), animations: "disabled" });
    const dialogOverflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByText("Importar cadastro do relógio", { exact: true }).click();
    await page.getByLabel("Arquivo", { exact: true }).setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from("Matrícula;Nome;CPF\n99999;Pessoa Ágata Sintética;52998224725") });
    await page.getByRole("button", { name: "Ler títulos e amostra" }).click();
    await page.getByLabel("Fonte AFD").selectOption("synthetic-clock");
    await page.getByLabel("Documento ou motivo da importação").fill("Revisão sintética do cadastro do relógio");
    await page.getByRole("button", { name: "Gerar prévia conferida" }).click();
    await page.getByRole("alert").getByText("Confira o cadastro com mesmo nome completo").waitFor();
    if (!await page.getByRole("checkbox", { name: "Conferir linha 2" }).isDisabled()) throw new Error("UNVERIFIED_IDENTITY_SELECTABLE");
    await page.getByRole("alert").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${viewport.width}-alerta.png`), animations: "disabled" });
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    results.push({ ...viewport, bodyOverflow, dialogOverflow, pageErrors: errors });
    await page.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  console.log(JSON.stringify({ syntheticOnly: true, output, results }, null, 2));
  if (results.some(result => result.bodyOverflow || result.dialogOverflow || result.pageErrors.length)) throw new Error("VISUAL_CHECK_FAILED");
} finally {
  await browser?.close(); await server.close();
  const allowed = await realpath(tmpdir()) + path.sep;
  if (path.resolve(temporary).startsWith(allowed) && path.basename(temporary).startsWith("employee-numbers-visual-")) await rm(temporary, { recursive: true, force: true });
}
