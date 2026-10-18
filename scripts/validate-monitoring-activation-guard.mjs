import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareMonitoringActivation } from "./prepare-monitoring-activation.mjs";

// Disposable fixtures only. Never invokes preparation against the real package.
const temporaryRoot = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(temporaryRoot, "monitoring-activation-guard-"));
try {
  const destination = path.join(fixture, ".monitoring-worker/activation");
  await mkdir(destination, { recursive: true });
  const manifestPath = path.join(destination, "manifest.json");
  const schemaPath = path.join(destination, "schema.sql");
  const originalManifest = JSON.stringify({ applied: true, migrations: [{ version: "20261008132607" }] });
  const originalSchema = "-- immutable applied fixture\nselect 1;\n";
  await writeFile(manifestPath, originalManifest);
  await writeFile(schemaPath, originalSchema);

  // No migrations directory exists: refusal must precede generation and writes.
  await assert.rejects(prepareMonitoringActivation(fixture), /ACTIVATION_PACKAGE_ALREADY_APPLIED/);
  assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
  assert.equal(await readFile(schemaPath, "utf8"), originalSchema);

  await writeFile(manifestPath, "{invalid manifest");
  await assert.rejects(prepareMonitoringActivation(fixture), SyntaxError);
  assert.equal(await readFile(manifestPath, "utf8"), "{invalid manifest");
  assert.equal(await readFile(schemaPath, "utf8"), originalSchema);

  await writeFile(manifestPath, JSON.stringify({ applied: "true" }));
  await assert.rejects(prepareMonitoringActivation(fixture), /ACTIVATION_PACKAGE_INVALID_MANIFEST/);
  assert.equal(await readFile(schemaPath, "utf8"), originalSchema);

  await writeFile(manifestPath, JSON.stringify({ applied: false }));
  await mkdir(path.join(fixture, "supabase/migrations"), { recursive: true });
  await writeFile(path.join(fixture, "supabase/migrations/20261008132607_fixture.sql"), "select 1;");
  const result = await prepareMonitoringActivation(fixture);
  assert.equal(result.preparedOnly, true);
  assert.equal(result.migrations.length, 1);
  assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).applied, false);
  assert.match(await readFile(schemaPath, "utf8"), /20261008132607_fixture.sql/);
  console.log(JSON.stringify({ appliedPackagePreserved: true, invalidManifestRejected: true, unappliedFixturePrepared: true, realPackageTouched: false }));
} finally {
  const resolved = await realpath(fixture);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert.ok(path.basename(resolved).startsWith("monitoring-activation-guard-"));
  await rm(resolved, { recursive: true, force: true });
}
