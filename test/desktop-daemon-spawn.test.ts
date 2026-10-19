// The desktop app starts this computer's daemon (desktop/src/daemon-client.ts spawnDaemon): it must
// run on the app's relay, since a daemon not yet adopted follows the relay it starts on.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { daemonLogPath, noteDaemon, spawnDaemon } from "../desktop/src/daemon-client.ts";

test.skipIf(process.platform === "win32")("starts `kiwi daemon` for the home, on the app's relay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-"));
  const out = path.join(dir, "env.txt");
  // A stand-in kiwi that writes down what it was started with.
  const bin = path.join(dir, "kiwi");
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$1" "$KIWI_HOME" "$KIWI_RELAY" > ${JSON.stringify(`${out}.tmp`)}\nmv ${JSON.stringify(`${out}.tmp`)} ${JSON.stringify(out)}\n`);
  fs.chmodSync(bin, 0o755);
  const prev = process.env.KIWI_RELAY;
  process.env.KIWI_RELAY = "https://from-the-environment.example";
  try {
    spawnDaemon(bin, path.join(dir, "home"), "https://relay.example");
  } finally {
    if (prev === undefined) delete process.env.KIWI_RELAY;
    else process.env.KIWI_RELAY = prev;
  }
  for (let i = 0; i < 100 && !fs.existsSync(out); i++) await Bun.sleep(20);
  expect(fs.readFileSync(out, "utf8").split("\n")).toEqual(["daemon", path.join(dir, "home"), "https://relay.example", ""]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a kiwi that won't start is no uncaught error", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-home-"));
  spawnDaemon(path.join(os.tmpdir(), "kiwi-spawn-missing", "kiwi"), home, "https://relay.example");
  await Bun.sleep(50);
  fs.rmSync(home, { recursive: true, force: true });
});

test.skipIf(process.platform === "win32")("the daemon's output and the app's restarts land in KIWI_HOME/daemon.log, and a log over 1 MB moves to daemon.log.1", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-log-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(daemonLogPath(home), "x".repeat(1_000_001));
  const bin = path.join(dir, "kiwi");
  fs.writeFileSync(bin, "#!/bin/sh\necho started on stdout\necho failed on stderr >&2\n");
  fs.chmodSync(bin, 0o755);
  spawnDaemon(bin, home, "https://relay.example");
  for (let i = 0; i < 100 && !fs.readFileSync(daemonLogPath(home), "utf8").includes("stderr"); i++) await Bun.sleep(20);
  noteDaemon("the daemon wasn't answering; started it again", home);
  const log = fs.readFileSync(daemonLogPath(home), "utf8");
  expect(log).toMatch(/^started on stdout\nfailed on stderr\n\S+Z app: the daemon wasn't answering; started it again\n$/);
  expect(fs.statSync(`${daemonLogPath(home)}.1`).size).toBe(1_000_001);
  fs.rmSync(dir, { recursive: true, force: true });
});
