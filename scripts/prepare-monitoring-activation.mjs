import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Generates a reviewable bundle only. It never connects to or changes a database.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function prepareMonitoringActivation(root = projectRoot) {
  const destination = path.join(root, ".monitoring-worker/activation");
  // Preserve the applied package as evidence. Check before any filesystem write.
  let previousManifest;
  try {
    previousManifest = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previousManifest?.applied === true) {
    throw new Error("ACTIVATION_PACKAGE_ALREADY_APPLIED: preserve this package; subsequent migrations require a new reviewed package with its own verified baseline and destination");
  }
  if (previousManifest !== undefined && previousManifest?.applied !== false) {
    throw new Error("ACTIVATION_PACKAGE_INVALID_MANIFEST: applied must be explicitly false before regeneration");
  }
  const expectedProject = "kqgtnucqxqqgwdyvhvdd";
  const lastVerifiedVersion = "20261008121650";
  const lastVerifiedCount = 16;
  const directory = path.join(root, "supabase/migrations");
  const files = (await readdir(directory)).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name) && name.slice(0, 14) > lastVerifiedVersion).sort();
  if (!files.length) throw new Error("No pending migrations to prepare");
  const manifest = [];
  let sql = `-- REVIEW REQUIRED: project administrativo-cd-rh / Administrativo CD\n-- Expected project ref: ${expectedProject}; production database used by localhost:3000.\n-- No source files, photographs or attendance decisions are imported by this bundle.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\ndo $preflight$ begin\n if (select count(*) from supabase_migrations.schema_migrations) <> ${lastVerifiedCount}\n or (select max(version) from supabase_migrations.schema_migrations) is distinct from '${lastVerifiedVersion}' then\n raise exception 'MIGRATION_BASE_CHANGED: inspect the destination and regenerate the reviewed bundle';\n end if;\nend $preflight$;\n`;
  for (const file of files) {
    const source = await readFile(path.join(directory, file), "utf8");
    const version = file.slice(0, 14);
    const name = file.slice(15, -4);
    const sha256 = createHash("sha256").update(source).digest("hex");
    const delimiter = `$source_${sha256.slice(0, 24)}$`;
    if (source.includes(delimiter)) throw new Error("Unexpected migration delimiter");
    manifest.push({ version, name, file, sha256 });
    sql += `\n-- ${file}; sha256=${sha256}\n${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${delimiter}${source}${delimiter}]);\n`;
  }
  sql += "\nnotify pgrst, 'reload schema';\ncommit;\n";
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "schema.sql"), sql);
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify({ project: expectedProject, previousMigration: lastVerifiedVersion, previousCount: lastVerifiedCount, migrations: manifest, generatedAt: new Date().toISOString(), applied: false }, null, 2));
  return { preparedOnly: true, project: expectedProject, migrations: manifest.map(({ version, name }) => ({ version, name })), output: destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await prepareMonitoringActivation(), null, 2));
}
