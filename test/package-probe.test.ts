import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(60_000);

const dir = mkdtempSync(join(tmpdir(), "kiwi-package-probe-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const root = join(import.meta.dir, "..");
const probe = (keysJs: string) =>
  Bun.spawn([process.execPath, join(root, "desktop/scripts/package-probe.ts"), process.execPath, join(root, "src/cli/main.ts"), keysJs], { stdout: "pipe", stderr: "pipe" });

test("with a package's bun, its kiwi CLI as the relay and its keys worker: a channel is made, a message sent and read back, and its seat handed to the app", async () => {
  const built = await Bun.build({ entrypoints: [join(root, "desktop/src/keys-worker.ts")], target: "bun" });
  const keysJs = join(dir, "keys.js");
  writeFileSync(keysJs, await built.outputs[0]!.text());
  const run = probe(keysJs);
  const [out, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  expect(code).toBe(0);
  expect(out).toMatch(/^package-probe: kiwi \d+\.\d+\.\d+ on bun \d+\.\d+\.\d+: made a channel, sent #1 and read it back, and handed its seat to the app\n$/);
});

test("a keys worker that can't make a channel fails the probe, saying so", async () => {
  const keysJs = join(dir, "broken-keys.js");
  writeFileSync(keysJs, 'throw new Error("no keys here");\n');
  const run = probe(keysJs);
  const [err, code] = await Promise.all([new Response(run.stderr).text(), run.exited]);
  expect(code).not.toBe(0);
  expect(err).toContain("the package's keys worker failed");
});
