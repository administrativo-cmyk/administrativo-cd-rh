import { expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireWorkerProcessLock } from "@/lib/monitoring/ingestion/process-lock";
it("impede importador simultâneo e permite reinício após liberação", async () => {
 const parent = await realpath(tmpdir()); const directory = await realpath(await mkdtemp(path.join(parent, "monitoring-lock-test-")));
 let release: (() => Promise<void>) | undefined;
 try {
  release = await acquireWorkerProcessLock(directory);
  await expect(acquireWorkerProcessLock(directory)).rejects.toMatchObject({ code: "WORKER_ALREADY_RUNNING" });
  await release(); release = await acquireWorkerProcessLock(directory);
 } finally { await release?.(); if (directory.startsWith(parent + path.sep) && path.basename(directory).startsWith("monitoring-lock-test-")) await rm(directory, { recursive: true, force: true }); }
});
