import { applyAwarenessUpdate, encodeAwarenessUpdate, type Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { b64url, fromB64url } from "../crypto.ts";
import type { PipeIn, PipeOut } from "./held-pipe.ts";
import { writerFloor } from "./level.ts";

interface Changed {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface WriterGate {
  level: number;
  refused: () => void;
}

export function pipeDoc(doc: Y.Doc, awareness: Awareness, on: (out: PipeOut) => void, synced: Promise<void> = Promise.resolve(), gate?: WriterGate): PipeIn {
  const tag = Symbol("pipe");
  let closed = false;
  let ready = false;
  const others = (ids: readonly number[]): number[] => ids.filter((id) => id !== awareness.clientID);
  const onUpdate = (u: Uint8Array, origin: unknown): void => {
    if (ready && origin !== tag) on({ _tag: "Update", u: b64url(u) });
  };
  const onAware = ({ added, updated, removed }: Changed, origin: unknown): void => {
    const ids = others([...added, ...updated, ...removed]);
    if (ready && origin !== tag && ids.length) on({ _tag: "Aware", u: b64url(encodeAwarenessUpdate(awareness, ids)) });
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAware);
  void synced.then(() => {
    if (closed) return;
    ready = true;
    on({ _tag: "Update", u: b64url(Y.encodeStateAsUpdate(doc)) });
    const ids = others([...awareness.getStates().keys()]);
    if (ids.length) on({ _tag: "Aware", u: b64url(encodeAwarenessUpdate(awareness, ids)) });
    on({ _tag: "Ready" });
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    doc.off("update", onUpdate);
    awareness.off("update", onAware);
    awareness.setLocalState(null);
  };
  return {
    update: (u) => {
      if (closed) return;
      if (gate && writerFloor(doc) > gate.level) {
        close();
        return gate.refused();
      }
      Y.applyUpdate(doc, fromB64url(u), tag);
    },
    aware: (state) => {
      if (!closed) awareness.setLocalState(state);
    },
    close,
  };
}

export function mirrorAware(awareness: Awareness, u: string, origin: unknown): void {
  applyAwarenessUpdate(awareness, fromB64url(u), origin);
}
