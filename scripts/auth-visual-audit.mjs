import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.AUTH_VISUAL_AUDIT_URL ?? "http://localhost:4173";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDir = path.resolve("artifacts/auth-visual-audit");
const routes = ["/login", "/cadastro", "/cadastro/sucesso"];
const viewports = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const pages = [];

for (const route of routes) {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    const slug = route === "/login" ? "login" : route === "/cadastro" ? "cadastro" : "sucesso";
    await page.screenshot({ path: path.join(outputDir, `${slug}-${viewport.width}x${viewport.height}.png`), fullPage: false });

    const measurements = await page.evaluate(() => {
      const form = document.querySelector("form");
      const visual = document.querySelector(".auth-visual");
      const media = document.querySelector(".auth-success-media");
      const video = document.querySelector("video");
      const back = document.querySelector(".auth-back-button");
      const box = (element) => element ? element.getBoundingClientRect().toJSON() : null;
      return {
        actualViewport: { width: window.innerWidth, height: window.innerHeight },
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        documentHeight: document.documentElement.scrollHeight,
        headingVisible: Boolean(document.querySelector("h1")),
        formBox: box(form),
        visualBox: box(visual),
        visualDisplay: visual ? getComputedStyle(visual).display : null,
        mediaBox: box(media),
        videoBox: box(video),
        backBox: box(back),
      };
    });

    pages.push({ route, ...viewport, ...measurements, consoleErrors });
    await page.close();
  }
}

const interactionErrors = [];
const interaction = await browser.newPage({ viewport: { width: 390, height: 844 } });
interaction.on("console", (message) => { if (message.type() === "error") interactionErrors.push(message.text()); });
interaction.on("pageerror", (error) => interactionErrors.push(error.message));

await interaction.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
await interaction.getByLabel("Usuário", { exact: true }).fill("11111111111");
await interaction.getByLabel("Senha", { exact: true }).fill("segura123");
await interaction.getByRole("button", { name: "Entrar", exact: true }).click();
const invalidCpfVisible = await interaction.getByText("Informe um CPF válido", { exact: true }).isVisible();
await interaction.getByRole("button", { name: "Mostrar senha", exact: true }).click();
const passwordVisible = await interaction.getByLabel("Senha", { exact: true }).getAttribute("type") === "text";
await interaction.getByRole("button", { name: "Entrar com Google", exact: true }).click();
const googleMockVisible = await interaction.getByText("Integração Google será habilitada em breve.", { exact: true }).isVisible();
await interaction.getByRole("link", { name: "Cadastre-se", exact: true }).click();
await interaction.waitForURL("**/cadastro");

await interaction.getByLabel("Nome completo", { exact: true }).fill("Marina Duarte");
await interaction.getByLabel("CPF", { exact: true }).fill("52998224725");
await interaction.getByLabel("Senha", { exact: true }).fill("segura123");
await interaction.getByLabel("Confirmar senha", { exact: true }).fill("segura123");
await interaction.getByRole("button", { name: "Cadastrar", exact: true }).click();
await interaction.waitForURL("**/cadastro/sucesso");

const video = interaction.getByTestId("registration-success-video");
await video.waitFor({ state: "visible" });
await interaction.waitForFunction(() => {
  const element = document.querySelector("video");
  return element instanceof HTMLVideoElement && element.readyState >= 1;
}, undefined, { timeout: 10000 }).catch(() => {});
const videoState = await video.evaluate((element) => ({
  autoplay: element.autoplay,
  muted: element.muted,
  playsInline: element.playsInline,
  loop: element.loop,
  controls: element.controls,
  paused: element.paused,
  readyState: element.readyState,
  duration: Number.isFinite(element.duration) ? element.duration : null,
  videoWidth: element.videoWidth,
  videoHeight: element.videoHeight,
  currentTime: element.currentTime,
}));
await video.dispatchEvent("ended");
const stayedAfterEnd = interaction.url().endsWith("/cadastro/sucesso");
await video.dispatchEvent("error");
const fallbackVisible = await interaction.getByTestId("registration-success-fallback").isVisible();
await interaction.getByRole("link", { name: "Voltar para o login", exact: true }).click();
await interaction.waitForURL("**/login");
const backToLogin = interaction.url().endsWith("/login");
await interaction.close();

const existingPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const existingPageErrors = [];
existingPage.on("console", (message) => { if (message.type() === "error") existingPageErrors.push(message.text()); });
existingPage.on("pageerror", (error) => existingPageErrors.push(error.message));
await existingPage.goto(baseUrl, { waitUntil: "networkidle" });
const dailyCallPreserved = await existingPage.getByRole("heading", { name: "Chamada Diária", exact: true }).isVisible();
await existingPage.close();
await browser.close();

const report = {
  pages,
  interactions: { invalidCpfVisible, passwordVisible, googleMockVisible, videoState, stayedAfterEnd, fallbackVisible, backToLogin, consoleErrors: interactionErrors },
  dailyCall: { preserved: dailyCallPreserved, consoleErrors: existingPageErrors },
};
await writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failures = [
  ...pages.flatMap((page) => [
    page.actualViewport.width !== page.width || page.actualViewport.height !== page.height ? `${page.route} ${page.width}x${page.height}: viewport incorreto` : null,
    page.overflowX ? `${page.route} ${page.width}x${page.height}: overflow horizontal` : null,
    !page.headingVisible ? `${page.route} ${page.width}x${page.height}: título ausente` : null,
    page.consoleErrors.length ? `${page.route} ${page.width}x${page.height}: erro de console` : null,
  ]),
  ...pages.filter((page) => page.route !== "/cadastro/sucesso" && page.width > 900 && page.visualDisplay === "none").map((page) => `${page.route} ${page.width}x${page.height}: painel institucional ausente`),
  ...pages.filter((page) => page.route !== "/cadastro/sucesso" && page.width <= 640 && page.visualDisplay !== "none").map((page) => `${page.route} ${page.width}x${page.height}: painel deveria priorizar formulário no mobile`),
  ...pages.filter((page) => page.route === "/cadastro/sucesso" && (!page.mediaBox || !page.videoBox || page.videoBox.width > page.mediaBox.width + 1)).map((page) => `${page.route} ${page.width}x${page.height}: vídeo excede o contêiner`),
  !invalidCpfVisible || !passwordVisible || !googleMockVisible ? "interações de login incompletas" : null,
  !videoState.autoplay || !videoState.muted || !videoState.playsInline || videoState.loop || videoState.controls ? "configuração do vídeo incorreta" : null,
  !stayedAfterEnd || !fallbackVisible || !backToLogin ? "fluxo de sucesso incompleto" : null,
  interactionErrors.length || existingPageErrors.length ? "erro de console durante fluxos" : null,
  !dailyCallPreserved ? "Chamada Diária não encontrada" : null,
].filter(Boolean);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
