import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = resolve("scripts/apply-clock-photo-backfill.mjs");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture(mode: "protected" | "old-api" | "old-ack", duplicate = false) {
  const directory = await mkdtemp(join(tmpdir(), "clock-photo-apply-test-")); temporary.push(directory);
  const artifacts = join(directory, "artifacts/clock-reconciliation");
  const images = join(directory, "relogio de ponto/user_images");
  await Promise.all([mkdir(artifacts, { recursive: true }), mkdir(images, { recursive: true })]);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#112233" } }).jpeg().toBuffer();
  const path = join(images, "12345678909.jpg"); await writeFile(path, bytes);
  const photo = { sourceId: "ponto-iso-cd-jk", identityType: "cpf", identityValue: "12345678909", path,
    sha256: createHash("sha256").update(bytes).digest("hex"), employeeId: "synthetic-employee", employeeNumber: "synthetic-001" };
  await writeFile(join(artifacts, "application-plan.json"), JSON.stringify({ photos: duplicate ? [photo, photo] : [photo] }));
  await writeFile(join(directory, ".env.local"), "MONITORING_INGEST_TOKEN=synthetic-only\n");
  const setup = join(directory, "offline-network.mjs");
  await writeFile(setup, `import {appendFile,readFile} from 'node:fs/promises';
globalThis.fetch=async (_url,options)=>{
 await appendFile('network.jsonl',JSON.stringify({method:options.method})+'\\n');
 if(options.method==='GET')return ${mode === "old-api" ? "new Response(null,{status:405})" : "Response.json({insertOnly:true,protocolVersion:1})"};
 const payload=JSON.parse(options.body);if(payload.insertOnly!==true)throw Error('MISSING_INSERT_ONLY');
 const expected=JSON.parse(await readFile('artifacts/clock-reconciliation/photo-expected.json','utf8'));
 return Response.json(${mode === "old-ack" ? "{accepted:true}" : "{accepted:true,insertOnly:true,status:'inserted',sha256:expected[0].storedSha256}"});
};`);
  const run = () => execute(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(setup).href, script, "--apply"], {
    cwd: directory, env: { ...process.env, MONITORING_INGEST_TOKEN: "synthetic-only" }, timeout: 20000,
  });
  const calls = async () => {
    try { return (await readFile(join(directory, "network.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  };
  return { run, calls, receipts: join(artifacts, "photo-application-receipts.json") };
}

describe("aplicação privada de fotos somente ausentes", () => {
  it("recusa API antiga antes de enviar qualquer foto", async () => {
    const task = await fixture("old-api");
    await expect(task.run()).rejects.toThrow("PHOTO_INSERT_ONLY_API_UNAVAILABLE");
    expect(await task.calls()).toEqual([{ method: "GET" }]);
  });
  it("recusa CPF duplicado no plano antes de qualquer chamada de rede", async () => {
    const task = await fixture("protected", true);
    await expect(task.run()).rejects.toThrow("PHOTO_PLAN_DUPLICATE_CPF");
    expect(await task.calls()).toEqual([]);
  });
  it("registra apenas confirmação protegida e reutiliza recibo sem repetir POST", async () => {
    const task = await fixture("protected");
    expect((await task.run()).stdout).toContain('"accepted":1');
    const receipts = JSON.parse(await readFile(task.receipts, "utf8"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ accepted: true, insertOnly: true, status: "inserted" });
    expect((await task.run()).stdout).toContain('"accepted":1');
    expect(await task.calls()).toEqual([{ method: "GET" }, { method: "POST" }, { method: "GET" }]);
  });
  it("não grava recibo diante de sucesso sem confirmação insertOnly", async () => {
    const task = await fixture("old-ack");
    await expect(task.run()).rejects.toThrow("PHOTO_UPLOAD_NOT_CONFIRMED");
    await expect(readFile(task.receipts)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
