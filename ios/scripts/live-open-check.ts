import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { liveState, sealLive } from "@kiwi/core/live.ts";

const shared = join(import.meta.dir, "..", "Shared");
const dir = mkdtempSync(join(tmpdir(), "live-open-"));

const builder = { name: "builder-one", face: "builder", color: "green", task: "T52 Relay: Live Activity pushes 🚀", since: 1_800_000_000_000, title: "channels" };
const lead = { name: "tidy-gazelle", face: "lead", color: "blue", task: null, since: 1_799_999_000_000, title: "channels", needs: 2, line: "Two things wait on you: T12 and #340 🚦" };

const expected = {
  agents: [
    { name: "tidy-gazelle", face: "lead", color: 0x4a8df0, task: "", since: 1_799_999_000 },
    { name: "builder-one", face: "builder", color: 0x3fbf74, task: builder.task, since: 1_800_000_000 },
  ],
  title: "channels",
  needs: 2,
  line: lead.line,
  elsewhere: 0,
};

try {
  const key = newChannelKey();
  const room = "AbC-dEf_ghIJklmnOPqrsT";
  const blobs = [await sealLive(key, room, liveState(builder)), await sealLive(key, room, liveState(lead)), await sealLive(newChannelKey(), room, liveState(builder))];
  const vector = join(dir, "vector.json");
  writeFileSync(vector, JSON.stringify({ key, room, sealed: blobs.map((b) => [b.iv, b.ct]) }));
  const bin = join(dir, "open");
  const built = Bun.spawnSync(["xcrun", "swiftc", "-o", bin, join(import.meta.dir, "live-open", "main.swift"), join(shared, "LiveOpen.swift"), join(shared, "Fills.swift")]);
  if (built.exitCode !== 0) throw new Error(`swiftc failed:\n${built.stderr.toString()}`);
  const ran = Bun.spawnSync([bin, vector]);
  if (ran.exitCode !== 0) throw new Error(`the Swift side failed:\n${ran.stderr.toString()}`);
  const got = JSON.parse(ran.stdout.toString()) as unknown;
  if (!Bun.deepEquals(got, expected)) {
    console.error(`the widget opened the daemon's blobs differently:\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
  console.log("the widget opens the daemon's sealed blobs, and nothing sealed for another room or key");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
