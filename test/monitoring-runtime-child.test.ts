import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
it("encerra filho próprio quando o canal do supervisor desaparece", async () => {
 const child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("scripts/monitoring-runtime-child.mjs")).href, "-e", "process.send({ready:true});setInterval(()=>{},1000)"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
 try {
  await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`Child exited before ready: ${code}`))); });
  const exit = new Promise<number | null>(resolve => child.once("exit", resolve));
  child.disconnect(); expect(await exit).toBe(1);
 } finally { if (child.exitCode === null) child.kill(); }
}, 15000);
