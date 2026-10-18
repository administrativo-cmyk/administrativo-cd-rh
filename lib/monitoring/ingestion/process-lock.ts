import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { ImportError } from "./validation.ts";

/** OS-owned lease: releases even after a crash; a stale PID file cannot prevent restart. */
export async function acquireWorkerProcessLock(stateDirectory: string): Promise<() => Promise<void>> {
 await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
 const directory = await realpath(stateDirectory);
 const hash = createHash("sha256").update(process.platform === "win32" ? directory.toLowerCase() : directory).digest("hex");
 const server = createServer(socket => socket.destroy()); server.maxConnections = 1;
 try {
  await new Promise<void>((resolve, reject) => {
   server.once("error", reject);
   if (process.platform === "win32") server.listen(`\\\\.\\pipe\\administrativo-cd-monitoring-${hash.slice(0, 40)}`, resolve);
   else server.listen({ host: "127.0.0.1", port: 30000 + Number.parseInt(hash.slice(0, 7), 16) % 25000, exclusive: true }, resolve);
  });
 } catch (error) {
  server.close();
  throw new ImportError((error as NodeJS.ErrnoException).code === "EADDRINUSE" ? "WORKER_ALREADY_RUNNING" : "WORKER_LOCK_UNAVAILABLE");
 }
 return () => new Promise<void>(resolve => server.close(() => resolve()));
}
