import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.VISUAL_AUDIT_URL ?? "http://localhost:5173/";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDir = path.resolve("artifacts/visual-audit");
const viewports = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const results = [];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outputDir, `${viewport.width}x${viewport.height}-today.png`), fullPage: false });
  const measurements = await page.evaluate(() => {
    const sidebar = document.querySelector("aside");
    const tableScroller = document.querySelector('[data-testid="today-table"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth,
      sidebarVisible: sidebar ? sidebar.getBoundingClientRect().right > 0 : false,
      internalTableScroll: tableScroller ? tableScroller.scrollWidth > tableScroller.clientWidth : false,
      headingVisible: Boolean(document.querySelector("h1")),
    };
  });
  results.push({ ...viewport, ...measurements, consoleErrors });
  await page.close();
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto(baseUrl, { waitUntil: "networkidle" });
await desktop.getByRole("button", { name: "Per\u00edodo", exact: true }).click();
const grid = desktop.getByLabel("Grade de chamada por per\u00edodo", { exact: true });
await grid.waitFor({ state: "visible" });
const sticky = await grid.evaluate((element) => {
  const headers = [...element.querySelectorAll("thead th")].slice(0, 7);
  const before = headers.map((header) => ({ left: Math.round(header.getBoundingClientRect().left), position: getComputedStyle(header).position, zIndex: getComputedStyle(header).zIndex }));
  element.scrollLeft = 620;
  element.scrollTop = 260;
  const after = headers.map((header) => ({ left: Math.round(header.getBoundingClientRect().left), top: Math.round(header.getBoundingClientRect().top) }));
  const frame = element.getBoundingClientRect();
  return { before, after, frameTop: Math.round(frame.top), horizontalScroll: element.scrollWidth > element.clientWidth, verticalScroll: element.scrollHeight > element.clientHeight };
});
await desktop.screenshot({ path: path.join(outputDir, "1440x900-period-scrolled.png"), fullPage: false });

const stateSelect = desktop.getByLabel("Simular estado da interface", { exact: true });
await stateSelect.selectOption("loading");
const loadingVisible = await desktop.getByLabel("Carregando colaboradores", { exact: true }).isVisible();
await stateSelect.selectOption("error");
const errorVisible = await desktop.getByRole("heading", { name: "N\u00e3o foi poss\u00edvel carregar a chamada", exact: true }).isVisible();
await stateSelect.selectOption("empty");
const emptyVisible = await desktop.getByRole("heading", { name: "Nenhum colaborador cadastrado", exact: true }).isVisible();
await stateSelect.selectOption("ready");
const collaboratorSearch = desktop.getByLabel("Buscar colaborador", { exact: true });
await collaboratorSearch.fill("colaborador inexistente 99999");
const noResultsVisible = await desktop.getByRole("heading", { name: "Nenhum resultado encontrado", exact: true }).isVisible();
await collaboratorSearch.fill("");
await collaboratorSearch.focus();
const focusVisible = await collaboratorSearch.evaluate((element) => document.activeElement === element);
const exportButton = desktop.getByRole("button", { name: "Exportar", exact: true });
const backgroundBeforeHover = await exportButton.evaluate((element) => getComputedStyle(element).backgroundColor);
await exportButton.hover();
const backgroundAfterHover = await exportButton.evaluate((element) => getComputedStyle(element).backgroundColor);
const hoverVisible = backgroundBeforeHover !== backgroundAfterHover;
await desktop.getByRole("button", { name: "Atualizar", exact: true }).click();
const successToast = desktop.getByText("Chamada atualizada com sucesso", { exact: true });
await successToast.waitFor({ state: "visible", timeout: 3000 });
const successVisible = await successToast.isVisible();

await desktop.getByRole("button", { name: "Recolher menu lateral", exact: true }).click();
await desktop.getByRole("button", { name: "Chamada Di\u00e1ria", exact: true }).hover();
const collapsedTooltip = desktop.getByRole("tooltip");
await collapsedTooltip.waitFor({ state: "visible", timeout: 3000 });
const collapsedTooltipVisible = await collapsedTooltip.isVisible();
await desktop.close();

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(baseUrl, { waitUntil: "networkidle" });
await mobile.getByRole("button", { name: "Abrir detalhes de Marina Duarte", exact: true }).click();
await mobile.getByTestId("employee-drawer").waitFor({ state: "visible" });
await mobile.waitForTimeout(600);
await mobile.screenshot({ path: path.join(outputDir, "390x844-drawer.png"), fullPage: false });
const drawerFits = await mobile.getByTestId("employee-drawer").evaluate((element) => {
  const box = element.getBoundingClientRect();
  return box.left >= 0 && box.right <= window.innerWidth && box.width <= window.innerWidth;
});
await mobile.getByRole("button", { name: "Fechar painel", exact: true }).click();
await mobile.getByRole("button", { name: "Status de Marina Duarte", exact: true }).click();
await mobile.waitForTimeout(300);
const activeStatusVisible = await mobile.locator('[data-slot="popover-content"] button[aria-pressed="true"]').isVisible();
const popoverFits = await mobile.getByText("Registrar ocorr\u00eancia", { exact: true }).evaluate((element) => {
  const box = element.closest('[data-slot="popover-content"]')?.getBoundingClientRect();
  return Boolean(box && box.left >= 0 && box.right <= window.innerWidth);
});
await mobile.screenshot({ path: path.join(outputDir, "390x844-status-popover.png"), fullPage: false });
await mobile.close();
await browser.close();

const report = { viewports: results, periodGrid: sticky, states: { loadingVisible, emptyVisible, noResultsVisible, errorVisible, successVisible, hoverVisible, focusVisible, activeStatusVisible }, collapsedTooltipVisible, mobile: { drawerFits, popoverFits } };
await writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failures = [
  ...results.flatMap((result) => [result.viewport.width !== result.width || result.viewport.height !== result.height ? `${result.width}x${result.height}: viewport incorreto` : null, result.bodyOverflowX ? `${result.width}x${result.height}: overflow global` : null, result.consoleErrors.length ? `${result.width}x${result.height}: erro de console` : null]),
  ...results.filter((result) => result.sidebarVisible !== (result.width >= 1024)).map((result) => `${result.width}x${result.height}: visibilidade incorreta da sidebar`),
  !sticky.horizontalScroll || !sticky.verticalScroll ? "PeriodGrid sem scroll esperado" : null,
  sticky.before.some((column) => column.position !== "sticky") ? "coluna cadastral sem sticky" : null,
  !loadingVisible || !emptyVisible || !noResultsVisible || !errorVisible || !successVisible || !hoverVisible || !focusVisible || !activeStatusVisible ? "estado visual ausente" : null,
  !collapsedTooltipVisible ? "tooltip da sidebar recolhida ausente" : null,
  !drawerFits || !popoverFits ? "drawer ou popover excede mobile" : null,
].filter(Boolean);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
