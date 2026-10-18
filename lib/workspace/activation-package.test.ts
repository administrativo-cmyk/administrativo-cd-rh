import { mkdtemp,mkdir,readFile,readdir,writeFile,rm,realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect,it } from "vitest";
import { prepareSystemActivation } from "../../scripts/prepare-system-activation.mjs";
it("refuses empty/new baseline or applied packages and keeps the old applied evidence untouched",async()=>{
 const base=await realpath(tmpdir()); const directory=await mkdtemp(path.join(base,"cd-system-package-"));
 try {
  const migrations=path.join(directory,"supabase/migrations");await mkdir(migrations,{recursive:true});
  const previous=(await readdir(path.resolve("supabase/migrations"))).filter(name=>name.endsWith(".sql")&&name.slice(0,14)<="20261017185924");
  for(const name of previous)await writeFile(path.join(migrations,name),"select 1;");
  const pending="20261018001547_test.sql";await writeFile(path.join(migrations,pending),"");
  await expect(prepareSystemActivation(directory)).rejects.toThrow("EMPTY_MIGRATION");
  await writeFile(path.join(migrations,pending),"select 2;");
  const old=path.join(directory,".monitoring-worker/activation");await mkdir(old,{recursive:true});await writeFile(path.join(old,"manifest.json"),'{"applied":true}');
  const result=await prepareSystemActivation(directory);expect(result.preparedOnly).toBe(true);
  const manifestPath=path.join(result.destination,"manifest.json");const schema=await readFile(path.join(result.destination,"schema.sql"),"utf8");
  expect(schema).toContain("MIGRATION_BASE_CHANGED");expect(schema).toContain("array_agg(version order by version)");expect(schema).toContain("begin;");
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));manifest.applied=true;await writeFile(manifestPath,JSON.stringify(manifest));
  await expect(prepareSystemActivation(directory)).rejects.toThrow("APPLIED_OR_INVALID_PACKAGE");
  expect(await readFile(path.join(result.destination,"schema.sql"),"utf8")).toBe(schema);
  expect(await readFile(path.join(old,"manifest.json"),"utf8")).toBe('{"applied":true}');
 } finally {
  const resolved=await realpath(directory);if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith("cd-system-package-"))throw new Error("UNSAFE_TEST_PATH");
  await rm(resolved,{recursive:true,force:true});
 }
});
