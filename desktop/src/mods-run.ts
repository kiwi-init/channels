import fs from "node:fs";
import path from "node:path";

import type { ModsAnswer, ModsAsk } from "./mods-worker.ts";

function workerFile(): string {
  const file = ["mods.js", "mods-worker.ts"].map((n) => path.join(import.meta.dir, n)).find((n) => fs.existsSync(n));
  if (!file) throw new Error("this build has no mods worker");
  return file;
}

export function inModsWorker<T>(ask: ModsAsk, file: string = workerFile()): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { name: "mods", smol: true });
    let settled = false;
    const end = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      w.terminate();
      fn();
    };
    w.addEventListener("message", (e: MessageEvent<ModsAnswer>) => {
      const a = e.data;
      end(() => (a.ok ? resolve(a.value as T) : reject(new Error(a.error))));
    });
    w.addEventListener("error", (e) => end(() => reject(new Error(e.message || "the mods worker failed"))));
    w.addEventListener("close", () => end(() => reject(new Error("the mods worker stopped before it answered"))));
    w.postMessage(ask);
  });
}
