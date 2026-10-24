"use client";

// Expanding the entire board must not start hundreds of history queries at once.
const concurrency = 4;
let active = 0;
const waiting: Array<() => void> = [];

function drain() {
  while (active < concurrency && waiting.length) waiting.shift()!();
}

export function runPeriodPunchRead<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    function cancel() {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(signal.reason);
    }
    function start() {
      signal.removeEventListener("abort", cancel);
      active += 1;
      void Promise.resolve().then(() => {
        signal.throwIfAborted();
        return read();
      }).then(resolve, reject).finally(() => { active -= 1; drain(); });
    }
    signal.addEventListener("abort", cancel, { once: true });
    waiting.push(start);
    drain();
  });
}
