import path from "node:path";

import { attachKeys, dataDir } from "./host-eb.ts";
import { bunWorker, keysController, type KeysFrame } from "./keys-eb.ts";
import { answerKeys } from "./keys-host.ts";
import { personPk, store } from "./store.ts";

let toPage: (frame: KeysFrame) => void = () => {};

export const keys = keysController({
  spawn: () => bunWorker(path.join(import.meta.dir, "keys.js")),
  init: () => ({ type: "init", relay: store.relayUrl, dir: dataDir, seats: store.channels, person: personPk(), mine: store.computers.map((c) => c.machinePk) }),
  answer: answerKeys,
  toPage: (frame) => toPage(frame),
});

export function keysToPage(send: (frame: KeysFrame) => void): void {
  toPage = send;
}

export function startKeys(): void {
  attachKeys((m) => keys.tell(m));
  keys.start();
}
