import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Preparation only. Never connects to a database or modifies the applied monitoring package.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "20261017185924";
const project = "kqgtnucqxqqgwdyvhvdd";
export async function prepareSystemActivation(projectRoot = root) {
 const destination = path.join(projectRoot, ".monitoring-worker", "activation-system-20261018");
 let existing;
 try { existing = JSON.parse(await readFile(path.join(destination,"manifest.json"),"utf8")); } catch(error) { if(error.code!=="ENOENT")throw error; }
 if(existing && existing.applied !== false)throw new Error("APPLIED_OR_INVALID_PACKAGE: preserve the existing package");
 const directory = path.join(projectRoot,"supabase","migrations");
 const files = (await readdir(directory)).filter(name=>/^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
 const previousVersions = files.filter(name=>name.slice(0,14)<=baseline).map(name=>name.slice(0,14));
 if(previousVersions.length!==22 || previousVersions.at(-1)!==baseline)throw new Error("LOCAL_BASELINE_CHANGED");
 const pending = files.filter(name=>name.slice(0,14)>baseline);
 if(!pending.length)throw new Error("NO_PENDING_MIGRATIONS");
 const migrations=[];
 let sql=`-- Target: administrativo-cd-rh / Administrativo CD / ${project}\n-- Reviewed application schema only. No personnel records, notices, photographs or source files are imported.\n-- Requires authenticated target verification before execution.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\ndo $baseline$ begin\n if (select array_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from array[${previousVersions.map(version=>`'${version}'`).join(",")}]::text[] then\n raise exception 'MIGRATION_BASE_CHANGED';\n end if;\nend $baseline$;\n`;
 for(const file of pending){
  const source=await readFile(path.join(directory,file),"utf8");
  if(!source.trim())throw new Error(`EMPTY_MIGRATION: ${file}`);
  const version=file.slice(0,14),name=file.slice(15,-4),sha256=createHash("sha256").update(source).digest("hex");
  const delimiter=`$source_${sha256.slice(0,24)}$`;
  if(source.includes(delimiter))throw new Error("INVALID_SOURCE_DELIMITER");
  migrations.push({version,name,file,sha256});
  sql+=`\n-- ${file} sha256=${sha256}\n${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${delimiter}${source}${delimiter}]);\n`;
 }
 sql+="\nnotify pgrst, 'reload schema';\ncommit;\n";
 const manifest={project,previousVersions,migrations,schemaSha256:createHash("sha256").update(sql).digest("hex"),generatedAt:new Date().toISOString(),applied:false};
 await mkdir(destination,{recursive:true});
 await writeFile(path.join(destination,"schema.sql"),sql);
 await writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest,null,2));
 return {preparedOnly:true,project,destination,migrations:migrations.map(({version,name})=>({version,name})),schemaSha256:manifest.schemaSha256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await prepareSystemActivation(),null,2));
