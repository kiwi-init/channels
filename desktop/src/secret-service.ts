import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { childEnv } from "./child-env.ts";

const SECRETS = "org.freedesktop.secrets";
const SEARCH_MS = 5_000;

const STORE_KEY_ATTRIBUTES = "{'service': 'Channels', 'account': 'store-key'}";

export const holdsItems = (reply: string | null): boolean => reply !== null && reply.includes("objectpath");

export function storeKeyHeld(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "gdbus",
      [
        "call",
        "--session",
        "--timeout",
        String(SEARCH_MS / 1000),
        "--dest",
        SECRETS,
        "--object-path",
        "/org/freedesktop/secrets",
        "--method",
        "org.freedesktop.Secret.Service.SearchItems",
        STORE_KEY_ATTRIBUTES,
      ],
      { timeout: SEARCH_MS + 2_000, env: childEnv() },
      (err, stdout) => resolve(err ? false : holdsItems(stdout)),
    );
  });
}

export const ownedReply = (reply: string | null): boolean => reply !== null && reply.trim().startsWith("(true");

export function keyringRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "gdbus",
      ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", SECRETS],
      { timeout: SEARCH_MS, env: childEnv() },
      (err, stdout) => resolve(err ? false : ownedReply(stdout)),
    );
  });
}

const CANCELLED = /org\.freedesktop\.Secret\.Prompt\.Completed \(true,/;

export const isCancel = (line: string): boolean => CANCELLED.test(line);

export function watchCancels(onCancel: () => void): () => void {
  const monitor = spawn("gdbus", ["monitor", "--session", "--dest", SECRETS], { stdio: ["ignore", "pipe", "ignore"], env: childEnv() });
  monitor.on("error", () => {});
  createInterface({ input: monitor.stdout }).on("line", (line) => {
    if (isCancel(line)) onCancel();
  });
  return () => monitor.kill();
}
