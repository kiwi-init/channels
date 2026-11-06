import fs from "node:fs";
import path from "node:path";

import type { KeyBindingsView } from "./bridge.ts";

const NAME = "keys.json";
const MAX_BYTES = 64 * 1024;
const WAIT_MS = 150;

const keysPath = (home: string): string => path.join(home, NAME);

export function readKeys(home: string): KeyBindingsView {
  const file = keysPath(home);
  let text: string;
  try {
    if (fs.statSync(file).size > MAX_BYTES) return { file, present: true, keys: null, error: "is over 64 KB" };
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { file, present: false, keys: null };
    return { file, present: true, keys: null, error: "couldn't be read" };
  }
  try {
    return { file, present: true, keys: JSON.parse(text) as unknown };
  } catch {
    // A half-saved or mistyped file: the person sees why, and every key stays at its default.
    return { file, present: true, keys: null, error: "isn't valid JSON" };
  }
}

export function watchKeys(home: string, changed: () => void, stopped: () => void): () => void {
  fs.mkdirSync(home, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(home, { persistent: false }, (_event, name) => {
    if (name !== null && name !== NAME) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      changed();
    }, WAIT_MS);
  });
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
  watcher.on("error", () => {
    stop();
    stopped();
  });
  return stop;
}
