// Build a disposable source copy without touching the active checkout's .next.
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = await realpath(process.cwd());
// Keep the copy on the same volume: Next/Webpack cannot relativize C:/ to D:/.
const temporaryBase = await realpath(path.dirname(root));
const temporary = await realpath(await mkdtemp(path.join(temporaryBase, "monitoring-build-")));
const dependencies = path.join(temporary, "node_modules");
const output = path.join(root, "artifacts", "isolated-build");
const webpack = process.argv.includes("--webpack");
const retain = process.argv.includes("--retain-runtime");
if (process.argv.slice(2).some((argument) => !["--webpack", "--retain-runtime"].includes(argument))) throw new Error("Supported options: --webpack, --retain-runtime");
if (temporary === root || temporary.startsWith(root + path.sep) || !temporary.startsWith(temporaryBase + path.sep)) throw new Error("UNSAFE_BUILD_DIRECTORY");
const sources = ["app", "components", "hooks", "lib", "public", "test", "scripts", "vendor"];
const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", "next-env.d.ts", "postcss.config.mjs", "eslint.config.mjs", "vitest.config.ts", "proxy.ts", "components.json", ".env.local"];
const privateValues = [];
let junctionCreated = false;
let result;
try {
  await mkdir(output, { recursive: true });
  for (const item of [...sources, ...files]) {
    const source = path.join(root, item);
    try { await access(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    await cp(source, path.join(temporary, item), { recursive: sources.includes(item), dereference: false });
    if (item === ".env.local") {
      for (const line of (await readFile(source, "utf8")).split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?[A-Z_][A-Z_0-9]*\s*=\s*(.*?)\s*$/i.exec(line);
        if (match) { const value = match[1].replace(/^(["'])(.*)\1$/, "$2"); if (value.length >= 8) privateValues.push(value); }
      }
    }
  }
  await symlink(path.join(root, "node_modules"), dependencies, process.platform === "win32" ? "junction" : "dir");
  junctionCreated = true;
  const arguments_ = [path.join(dependencies, "next", "dist", "bin", "next"), "build", ...(webpack ? ["--webpack"] : [])];
  const startedAt = new Date().toISOString();
  const chunks = [];
  const child = spawn(process.execPath, arguments_, { cwd: temporary, windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => chunks.push(data.toString()));
  child.stderr.on("data", (data) => chunks.push(data.toString()));
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  let log = chunks.join("").replace(/\u001b\[[0-9;]*m/g, "");
  for (const value of privateValues.sort((a, b) => b.length - a.length)) log = log.split(value).join("[REDACTED_ENV_VALUE]");
  const bundler = webpack ? "webpack" : "turbopack";
  result = { isolated: true, bundler, exitCode, startedAt, finishedAt: new Date().toISOString(), checkoutBuildDirectoryUsed: false, log: path.join(output, `${bundler}.log`) };
  await writeFile(result.log, log);
  await writeFile(path.join(output, `${bundler}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(log.split(/\r?\n/).slice(-36).join("\n"));
  if (exitCode !== 0) process.exitCode = 1;
  if (exitCode === 0 && retain) {
    // A versioned release is prepared without switching a running application.
    const releases = path.join(root, ".monitoring-worker", "runtime", "releases");
    await mkdir(releases, { recursive: true });
    const release = await mkdtemp(path.join(releases, "validated-"));
    for (const item of [".next", "public", "package.json", "next.config.ts"]) {
      const cache = path.join(temporary, ".next", "cache");
      try { await cp(path.join(temporary, item), path.join(release, item), { recursive: true, filter: source => source !== cache && !source.startsWith(cache + path.sep) }); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await symlink(path.join(root, "node_modules"), path.join(release, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(output, "runtime-release.json"), JSON.stringify({ release, validatedAt: new Date().toISOString(), bundler, activationRequired: true }, null, 2));
    console.log(JSON.stringify({ runtimeRelease: release, activationRequired: true }));
  }
} finally {
  // Remove only the link, then delete the verified disposable directory.
  if (junctionCreated) await unlink(dependencies);
  const resolved = await realpath(temporary);
  if (resolved === temporary && resolved.startsWith(temporaryBase + path.sep) && path.basename(resolved).startsWith("monitoring-build-")) await rm(resolved, { recursive: true, force: true });
}
