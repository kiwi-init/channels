import { test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnDaemon } from "../../src/daemon/rpc.ts";
import { LEDGER_ENV } from "../../scripts/ci-owned.ts";
import { spawnOwned } from "../owned.ts";

const how = process.env.OWNED_CASE ?? "pass";
const report = process.env.OWNED_REPORT ?? "";

test(
  `an owned run that ends by ${how}`,
  async () => {
    spawnOwned(["sleep", "300"]);
    spawnOwned(["bash", "-c", "trap '' TERM; while true; do sleep 1; done"]);
    const home = mkdtempSync(join(tmpdir(), "kiwi-owned-daemon-"));
    mkdirSync(home, { recursive: true });
    spawnDaemon(home, [process.execPath, join(import.meta.dir, "owned-daemon.ts"), "daemon"]);
    await Bun.sleep(300);
    writeFileSync(report, readFileSync(process.env[LEDGER_ENV] ?? "", "utf8"));
    if (how === "fail") throw new Error("this test fails on purpose");
    if (how === "timeout" || how === "signal") await Bun.sleep(600_000);
  },
  how === "timeout" ? 1_000 : 600_000,
);
