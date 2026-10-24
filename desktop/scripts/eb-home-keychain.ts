import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

export function homeKeychain(home: string): () => void {
  const env = { ...process.env, HOME: home };
  const kc = join(home, "Library", "Keychains", "login.keychain");
  for (const args of [
    ["create-keychain", "-p", "", kc],
    ["set-keychain-settings", kc],
    ["default-keychain", "-d", "user", "-s", kc],
    ["list-keychains", "-d", "user", "-s", kc],
  ])
    execFileSync("security", args, { env, stdio: "ignore" });
  return () => void spawnSync("security", ["delete-keychain", kc], { env, stdio: "ignore" });
}

export function stuck(pid: number): string {
  const ps = spawnSync("ps", ["-o", "stat=,command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
  const sampled = spawnSync("sample", [String(pid), "1", "-mayDie"], { encoding: "utf8", timeout: 15_000 }).stdout;
  const frames = sampled
    .split("\n")
    .filter((l) => /^\s+[+!:|\s]*\d+ /.test(l))
    .slice(0, 25)
    .join("\n");
  return `${pid} ${ps}\n${frames}`;
}
