import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { TEST_STORE_FILE } from "../src/eb-test-store.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage (on a Mac): bun desktop/scripts/eb-unreadable-check.ts <Channels.app built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}

const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-unreadable-check-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];
const JUNK = "{ this was a store, and is not JSON any more";

function find(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = find(path, name);
      if (found) return found;
    } else if (entry.name === name) return path;
  }
  return null;
}

async function run(what: (d: Driver) => Promise<void>): Promise<void> {
  const started = launch(exe, env);
  try {
    const d = await attach(join(root, "driver.sock"));
    try {
      await until("the window on screen", 60_000, async () => (((await d.main("window")) as { visible?: unknown }).visible === true ? true : null));
      await what(d);
    } finally {
      d.close();
    }
  } finally {
    await stop(started);
  }
}

const heading = (d: Driver): Promise<string> => d.evaluate(() => document.querySelector("h1")?.textContent ?? "", null, 5_000);
const pageSays = (d: Driver): Promise<string> => d.evaluate(() => document.body.innerText, null, 5_000);

try {
  await run((d) => firstChannel(d, 0));
  console.log("first run: a person and a channel, saved in the store");
  const file = find(join(root, "home"), TEST_STORE_FILE);
  if (!file) throw new Error(`no ${TEST_STORE_FILE} after the first run`);
  writeFileSync(file, JUNK);
  await run(async (d) => {
    const title = await until("the page that says the keys can't be read", 30_000, async () => ((await heading(d)) === "Channels can't read your keys" ? true : null)).then(
      () => "Channels can't read your keys",
      async () => `"${await heading(d)}"`,
    );
    if (title !== "Channels can't read your keys") problems.push(`with a store that isn't JSON the window shows ${title}, not the page that says the keys can't be read`);
    const said = await pageSays(d);
    for (const want of [`${TEST_STORE_FILE} isn't JSON`, file, "main.log", "Try again"]) if (!said.includes(want)) problems.push(`the page doesn't say "${want}"`);
    console.log(`a store that isn't JSON: the window says "${title}", why, where the file is and where the details are`);
  });
  if (readFileSync(file, "utf8") !== JUNK) problems.push("the unreadable store was written over");
  else console.log("the unreadable store was left as it was");
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  const log = find(join(root, "home"), "main.log");
  console.error(`main.log: ${log ? readFileSync(log, "utf8").slice(-3000) : "none"}`);
} finally {
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: a store the app can't read gets its own page instead of first-run, and is never written over");
