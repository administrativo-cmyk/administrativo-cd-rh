import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { allowlistWithSource, parseSourceArgs, registerSource } from "../scripts/monitoring-register-source.mjs";
describe("registro local de fonte", () => {
 it("preserva credenciais e outras fontes sem repetir ID", () => {
  const original = "PRIVATE_TEST_TOKEN=dummy-only\nMONITORING_INGEST_SOURCE_IDS=existing\nOTHER=preserved";
  const result = allowlistWithSource(original, "new-source"); expect(result).toContain("MONITORING_INGEST_SOURCE_IDS=existing,new-source"); expect(result).toContain("PRIVATE_TEST_TOKEN=dummy-only"); expect(allowlistWithSource(result, "new-source")).toBe(result);
 });
 it("recusa linha ambígua, injeção de configuração e opções desconhecidas", () => {
  expect(() => allowlistWithSource("MONITORING_INGEST_SOURCE_IDS=a\nMONITORING_INGEST_SOURCE_IDS=b", "c")).toThrow();
  expect(() => allowlistWithSource("", "x\nOTHER=1")).toThrow();
  expect(() => parseSourceArgs(["--id", "source", "--root", "folder", "--unknown"])).toThrow();
  expect(parseSourceArgs(["--id", "source", "--root", "folder"])).toEqual({ id: "source", root: "folder" });
 });
 it("aplica somente após prévia e preserva fontes e segredos no arquivo", async () => {
  const parent = await realpath(tmpdir()); const directory = await realpath(await mkdtemp(path.join(parent, "monitoring-register-test-")));
  try {
   await mkdir(path.join(directory, "ponto"));
   const configFile = path.join(directory, "monitoramento.local.json"); const envFile = path.join(directory, ".env.local");
   const original = JSON.stringify({ version: 1, stateDirectory: ".monitoring-worker", sources: [{ id: "old", kind: "afd", root: "ponto", timeZone: "America/Sao_Paulo", identityNamespace: "old", afdProfile: "legacy" }] });
   await writeFile(configFile, original); await writeFile(envFile, "MONITORING_INGEST_SOURCE_IDS=old\nSECRET_SYNTHETIC=preserve-me");
   const options = { id: "new", kind: "afd", namespace: "new", root: "ponto", "afd-profile": "iso" };
   expect(await registerSource(options, directory)).toMatchObject({ apply: false }); expect(await readFile(configFile, "utf8")).toBe(original);
   await registerSource({ ...options, apply: true }, directory);
   expect(JSON.parse(await readFile(configFile, "utf8")).sources.map((source: { id: string }) => source.id)).toEqual(["old", "new"]);
   expect(await readFile(envFile, "utf8")).toContain("MONITORING_INGEST_SOURCE_IDS=old,new");
   expect(await readFile(envFile, "utf8")).toContain("SECRET_SYNTHETIC=preserve-me");
   await expect(registerSource({ id: "old", root: "ponto", kind: "defense-access" }, directory)).rejects.toThrow("SOURCE_IDENTITY_CHANGE_REQUIRES_NEW_SOURCE");
   await expect(registerSource({ id: "old", root: directory }, directory)).rejects.toThrow("SOURCE_ROOT_TOO_BROAD");
  } finally {
   const resolved = await realpath(directory);
   if (resolved.startsWith(parent + path.sep) && path.basename(resolved).startsWith("monitoring-register-test-")) await rm(resolved, { recursive: true, force: true });
  }
 });
});
