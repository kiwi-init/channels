import { test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnDaemon } from "../../src/daemon/rpc.ts";
import { LEDGER_ENV, running } from "../../scripts/ci-owned.ts";
import { spawnOwned } from "../owned.ts";

const how = process.env.OWNED_CASE ?? "pass";
const report = process.env.OWNED_REPORT ?? "";

const PARENT = `const c = Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] }); require("node:fs").writeFileSync(process.env.KID_FILE, String(c.pid)); setInterval(() => {}, 60_000);`;
const ORPHANER = `const c = Bun.spawn(["sleep", "300"], { detached: true, stdio: ["ignore", "ignore", "ignore"] }); c.unref(); require("node:fs").writeFileSync(process.env.KID_FILE, String(c.pid)); process.exit(0);`;

async function kid(file: string): Promise<number> {
  const end = Date.now() + 10_000;
  while (!existsSync(file) && Date.now() < end) await Bun.sleep(20);
  return Number(readFileSync(file, "utf8"));
}

test(
  `an owned run that ends by ${how}`,
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-owned-run-"));
    spawnOwned(["sleep", "300"]);
    spawnOwned(["bash", "-c", "trap '' TERM; while true; do sleep 1; done"]);
    spawnOwned(["sh", "-c", "exec sleep 300"]);
    spawnOwned([process.execPath, "-e", PARENT], { env: { ...process.env, KID_FILE: join(dir, "child") } });
    spawnOwned([process.execPath, "-e", ORPHANER], { env: { ...process.env, KID_FILE: join(dir, "orphan") } });
    const home = join(dir, "home");
    mkdirSync(home);
    spawnDaemon(home, [process.execPath, join(import.meta.dir, "owned-daemon.ts"), "daemon"]);
    const kids = [await kid(join(dir, "child")), await kid(join(dir, "orphan"))];
    await Bun.sleep(300);
    const roots = readFileSync(process.env[LEDGER_ENV] ?? "", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => Number(JSON.parse(l).pid));
    writeFileSync(report, [...roots, ...kids].map((pid) => JSON.stringify({ pid, alive: running(pid) })).join("\n"));
    if (how === "fail") throw new Error("this test fails on purpose");
    if (how === "timeout" || how === "signal") await Bun.sleep(600_000);
  },
  how === "timeout" ? 3_000 : 600_000,
);
