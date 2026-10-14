// Getting a seat back (T1426): the same key resumes; a new key never takes a seat over. A lost key
// means the owner removes the old seat and the agent joins again; until then, a name someone holds
// is offered the next free one.

import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, RelayError } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-reclaim-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the same key", () => {
  test("resumes without asking; a key that isn't a member can't", async () => {
    const owner = await generateIdentity("human");
    const win = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "human" }, [{ ...win, info: { name: "win" } }]);
    expect((await Channel.resume(relay, made.code, win)).roomId).toBe(made.access.roomId);
    await expect(Channel.resume(relay, made.code, await generateIdentity("win"))).rejects.toBeInstanceOf(RelayError);
  });
});

describe("a lost key, without reclaim", () => {
  test("the owner removes the old seat, and the agent joins again under its name", async () => {
    const owner = await generateIdentity("human");
    const oldKey = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, [{ ...oldKey, info: { name: "win", kind: "agent" } }]);
    const ownerCh = new Channel(made.access, relay, owner);
    // The key is lost: asking again under the same name, from a new key, is offered the next free name.
    const newKey = await generateIdentity("win");
    const first = await Channel.requestJoin(relay, made.code, newKey, { name: "win" });
    expect((await ownerCh.requests({ budget: memoryBudget() })).find((r) => r.id === first.requestId)?.name).toBe("win-2");
    await ownerCh.deny(first.requestId);
    // So the owner removes the old seat; then the same name is free for a new key.
    await ownerCh.remove(oldKey.pk);
    const again = await generateIdentity("win");
    const ask = await Channel.requestJoin(relay, made.code, again, { name: "win" });
    const r = (await ownerCh.requests({ budget: memoryBudget() })).find((x) => x.id === ask.requestId)!;
    expect(r.name).toBe("win");
    if (r.check !== "ready") {
      await Channel.joinStatus(relay, made.code, again, ask.requestId);
    }
    await ownerCh.approve((await ownerCh.requests()).find((x) => x.id === ask.requestId)!);
    const members = await ownerCh.members();
    expect(members.filter((m) => m.name === "win" && m.active).map((m) => m.pk)).toEqual([again.pk]);
    expect(members.find((m) => m.pk === oldKey.pk)?.active).toBe(false);
  });
});

describe("a taken name", () => {
  test("joining under a name someone holds comes in under the next free one, instead of failing", async () => {
    const homes: string[] = [];
    const home = () => {
      const d = mkdtempSync(join(tmpdir(), "kiwi-reclaim-"));
      homes.push(d);
      return d;
    };
    const run = async (dir: string, ...args: string[]) => {
      const p = Bun.spawn(kiwiCmd(args), {
        cwd: dir,
        env: { ...process.env, KIWI_HOME: dir, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", CLAUDECODE: "" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, out, err };
    };
    try {
      const owner = home();
      const code = /join code: (\S+)/.exec((await run(owner, "create", "proj", "--as", "lead")).out)![1]!;
      // "bob" is someone else's agent, already in.
      const bob = await generateIdentity("bob");
      const ownerSeat = JSON.parse(await Bun.file(join(owner, "config.json")).text()) as { channels: Record<string, { roomId: string }> };
      const room = Object.values(ownerSeat.channels)[0]!.roomId;
      const ask = await Channel.requestJoin(relay, code, bob, { name: "bob" });
      const approved = await run(owner, "--as", "human", "requests");
      expect(approved.code).toBe(0);
      const listed = /(\d{3}-\d{3})\s+bob/.exec(approved.out);
      if (listed) await run(owner, "--as", "human", "approve", listed[1]!, "--yes");
      else {
        await Channel.joinStatus(relay, code, bob, ask.requestId);
        const again = /(\d{3}-\d{3})\s+bob/.exec((await run(owner, "--as", "human", "requests")).out)!;
        await run(owner, "--as", "human", "approve", again[1]!, "--yes");
      }
      expect(room).toBeTruthy();
      // An agent typing --as bob: once the owner lets it in, it's bob-2 (the CLI no longer admits on the owner's computer itself).
      const joining = run(owner, "join", code, "--as", "bob");
      let pending: RegExpExecArray | null = null;
      for (let i = 0; i < 300 && !pending; i++) {
        pending = /(\d{3}-\d{3})\s+bob-2/.exec((await run(owner, "--as", "human", "requests")).out);
        if (!pending) await Bun.sleep(50);
      }
      await run(owner, "--as", "human", "approve", pending![1]!, "--yes");
      const joined = await joining;
      expect(joined.code).toBe(0);
      expect(joined.out).toContain('"bob-2"');
    } finally {
      for (const d of homes) rmSync(d, { recursive: true, force: true });
    }
  });
});
