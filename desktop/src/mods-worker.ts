import { parentPort } from "node:worker_threads";

import { checkUpdates, createMod, listMods, removeMod, updateMods, type ModStart } from "../../src/mods.ts";

export type ModsAsk =
  | { op: "list"; home: string }
  | { op: "check"; home: string }
  | { op: "update"; home: string; name: string }
  | { op: "remove"; home: string; name: string; force: boolean }
  | { op: "create"; home: string; name: string; start: ModStart };

export type ModsAnswer = { ok: true; value: unknown } | { ok: false; error: string };

const port = parentPort;
if (!port) throw new Error("the mods worker runs only inside a Worker");

function answer(ask: ModsAsk): unknown {
  if (ask.op === "list") return listMods(ask.home);
  if (ask.op === "check") return checkUpdates(ask.home);
  if (ask.op === "update") return updateMods(ask.home, ask.name, true);
  if (ask.op === "create") return createMod(ask.home, ask.name, ask.start);
  return removeMod(ask.home, ask.name, ask.force);
}

port.on("message", (ask: ModsAsk) => {
  let reply: ModsAnswer;
  try {
    reply = { ok: true, value: answer(ask) };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  port.postMessage(reply);
});
