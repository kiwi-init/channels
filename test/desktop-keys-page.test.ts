import { expect, test } from "bun:test";

import type { KeysPush, KeysReply, KeysRequest } from "../desktop/src/bridge.ts";
import type { KeysFrame } from "../desktop/src/keys-eb.ts";
import { keysPort, type KeysRoute } from "../desktop/src/keys-page.ts";

function route(answer: (req: KeysRequest) => Promise<KeysReply>, session: string): { r: KeysRoute; frame(f: KeysFrame): void; sent: { session: string; req: KeysRequest }[] } {
  const listeners = new Set<(f: KeysFrame) => void>();
  const sent: { session: string; req: KeysRequest }[] = [];
  return {
    r: {
      session,
      keys: (req) => {
        sent.push({ session, req });
        return answer(req);
      },
      onKeys: (cb) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
    },
    frame: (f) => {
      for (const cb of listeners) cb(f);
    },
    sent,
  };
}

test("each request gets the next id and goes with this page's session", async () => {
  const t = route(async (req) => ({ id: req.id, ok: true, value: null }), "page-one-session-id");
  const port = keysPort(t.r);
  expect(await port.request({ op: "nudge" })).toEqual({ id: 1, ok: true, value: null });
  await port.request({ op: "nudge" });
  expect(t.sent.map((s) => [s.session, s.req.id])).toEqual([
    ["page-one-session-id", 1],
    ["page-one-session-id", 2],
  ]);
});

test("pushes and restarts reach this page's listeners only for its own session, and stop once unsubscribed", () => {
  const t = route(async (req) => ({ id: req.id, ok: true, value: null }), "mine-mine-mine-mine");
  const port = keysPort(t.r);
  const pushes: KeysPush[] = [];
  let restarts = 0;
  const off = port.onPush((p) => pushes.push(p));
  port.onRestart(() => restarts++);
  t.frame({ session: "mine-mine-mine-mine", push: { sub: 1, event: null } });
  t.frame({ session: "an-older-page-session", push: { sub: 2, event: null } });
  t.frame({ session: "an-older-page-session", restart: true });
  t.frame({ session: "mine-mine-mine-mine", restart: true });
  off();
  t.frame({ session: "mine-mine-mine-mine", push: { sub: 3, event: null } });
  expect({ pushes, restarts }).toEqual({ pushes: [{ sub: 1, event: null }], restarts: 1 });
});

test("a refused or failed RPC comes back as an unreachable reply, never a rejection", async () => {
  const t = route(() => Promise.reject(new Error("keys takes a request with an id")), "page-one-session-id");
  const port = keysPort(t.r);
  expect(await port.request({ op: "nudge" })).toEqual({ id: 1, ok: false, error: { kind: "unreachable", message: "keys takes a request with an id" } });
});
