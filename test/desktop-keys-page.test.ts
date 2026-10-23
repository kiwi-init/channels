import { expect, test } from "bun:test";

import type { KeysPush, KeysReply, KeysRequest } from "../desktop/src/bridge.ts";
import type { KeysFrame } from "../desktop/src/keys-eb.ts";
import { keysPort, newSession, type KeysRoute } from "../desktop/src/keys-page.ts";

function route(answer: (session: string, req: KeysRequest) => Promise<KeysReply>): { r: KeysRoute; frame(f: KeysFrame): void; sent: { session: string; req: KeysRequest }[] } {
  const listeners = new Set<(f: KeysFrame) => void>();
  const sent: { session: string; req: KeysRequest }[] = [];
  return {
    r: {
      keys: (session, req) => {
        sent.push({ session, req });
        return answer(session, req);
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
  const t = route(async (_s, req) => ({ id: req.id, ok: true, value: null }));
  const port = keysPort(t.r, "page-one-session-id");
  expect(await port.request({ op: "nudge" } as Omit<KeysRequest, "id">)).toEqual({ id: 1, ok: true, value: null });
  await port.request({ op: "nudge" } as Omit<KeysRequest, "id">);
  expect(t.sent.map((s) => [s.session, s.req.id])).toEqual([
    ["page-one-session-id", 1],
    ["page-one-session-id", 2],
  ]);
});

test("pushes and restarts reach this page's listeners only for its own session, and stop once unsubscribed", () => {
  const t = route(async (_s, req) => ({ id: req.id, ok: true, value: null }));
  const port = keysPort(t.r, "mine-mine-mine-mine");
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
  const t = route(() => Promise.reject(new Error("keys takes { session, req }")));
  const port = keysPort(t.r, "page-one-session-id");
  expect(await port.request({ op: "nudge" } as Omit<KeysRequest, "id">)).toEqual({ id: 1, ok: false, error: { kind: "unreachable", message: "keys takes { session, req }" } });
});

test("a page's session is 32 random hex characters", () => {
  const a = newSession();
  expect(a).toMatch(/^[0-9a-f]{32}$/);
  expect(newSession()).not.toBe(a);
});
