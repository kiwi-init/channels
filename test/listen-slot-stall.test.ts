import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "bun";
import { holdListener } from "../src/daemon.ts";

setDefaultTimeout(30_000);

const dir = mkdtempSync(join(tmpdir(), "kiwi-slot-stall-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Held = { channel: string; agent: string; session: string };
type Conn = { id: number; buf: string; held: Held | null };

function stalledDaemon(sock: string, stallMs: number) {
  const until = Date.now() + stallMs;
  let chain: Promise<void> = Promise.resolve();
  const later = (step: () => void) => {
    chain = chain.then(async () => {
      const wait = until - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      step();
    });
  };
  const open = new Set<Conn>();
  let ids = 0;
  const server = Bun.listen<Conn>({
    unix: sock,
    socket: {
      open(s) {
        s.data = { id: ++ids, buf: "", held: null };
        open.add(s.data);
      },
      data(s: Socket<Conn>, bytes) {
        s.data.buf += new TextDecoder().decode(bytes);
        const lines = s.data.buf.split("\n");
        s.data.buf = lines.pop() ?? "";
        for (const line of lines.filter((l) => l.trim())) {
          const req = JSON.parse(line) as { id: number; verb: string; channel: string; as: string; session: string; kind: string };
          later(() => {
            if (req.verb !== "hold") return void s.write(`${JSON.stringify({ id: req.id, ok: true })}\n`);
            const taken = [...open].some((c) => c !== s.data && c.held && c.held.channel === req.channel && c.held.agent === req.as && c.held.session === req.session);
            if (!taken) s.data.held = { channel: req.channel, agent: req.as, session: req.session };
            s.write(`${JSON.stringify({ id: req.id, ok: true, held: !taken })}\n`);
          });
        }
      },
      close(s) {
        later(() => open.delete(s.data));
      },
    },
  });
  return { open, settled: () => chain, stop: () => server.stop(true) };
}

const hook = { channel: "ch", agent: "otter-gentle", kind: "hook" as const, cwd: "/work", harness: "claude", session: "s1", pid: process.pid, proc: null, marks: true };

describe("a hook's listen slot survives a stalled daemon (#2502)", () => {
  test("a hold that timed out leaves no connection behind once the daemon catches up", async () => {
    const sock = join(dir, "a.sock");
    const daemon = stalledDaemon(sock, 2_500);
    const first = await holdListener(hook, sock);
    expect(first.held).toBeNull();
    first.close();
    await Bun.sleep(2_700);
    await daemon.settled();
    expect(daemon.open.size).toBe(0);
    daemon.stop();
  });

  test("the hook's retry after a timed-out hold gets the slot, instead of colliding with its own earlier request", async () => {
    const sock = join(dir, "b.sock");
    const daemon = stalledDaemon(sock, 2_500);
    const first = await holdListener(hook, sock);
    expect(first.held).toBeNull();
    first.close();
    const retry = await holdListener(hook, sock);
    expect(retry.held).toBe(true);
    retry.close();
    daemon.stop();
  });
});
