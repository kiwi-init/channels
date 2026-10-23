import type { KeysPort, KeysPush, KeysReply, KeysRequest } from "./bridge.ts";
import type { KeysFrame } from "./keys-eb.ts";

export interface KeysRoute {
  readonly session: string;
  keys(req: KeysRequest): Promise<KeysReply>;
  onKeys(cb: (frame: KeysFrame) => void): () => void;
}

export function keysPort(route: KeysRoute): KeysPort {
  const session = route.session;
  let nextAsk = 1;
  const pushes = new Set<(p: KeysPush) => void>();
  const restarts = new Set<() => void>();
  route.onKeys((frame) => {
    if (frame.session !== session) return;
    if ("push" in frame) for (const cb of pushes) cb(frame.push);
    else for (const cb of restarts) cb();
  });
  return {
    request: (ask) => {
      const req = { ...ask, id: nextAsk++ } as KeysRequest;
      return route.keys(req).catch((e: unknown) => ({ id: req.id, ok: false, error: { kind: "unreachable", message: e instanceof Error ? e.message : String(e) } }) satisfies KeysReply);
    },
    onPush: (cb) => {
      pushes.add(cb);
      return () => void pushes.delete(cb);
    },
    onRestart: (cb) => {
      restarts.add(cb);
      return () => void restarts.delete(cb);
    },
  };
}
