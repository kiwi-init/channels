import fs from "node:fs";
import path from "node:path";

import { keepRecordsIn, type RecordMemory } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { JoinClaims } from "@kiwi/core/membership.ts";
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts";
import type { ChannelIdentityView } from "./bridge.ts";
import { writePrivate } from "./guard.ts";
import { Keyring } from "./keyring.ts";
import { bunSearchWorker } from "./search-host.ts";
import { serveKeys, type HostToKeys, type KeysToHost } from "./keys-server.ts";
import { keysParent, type PagePort } from "./keys-shim.ts";

type Done = Extract<HostToKeys, { type: "done" }>;
type Ask = Exclude<KeysToHost, { type: "flushed" }> extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;

interface Memory {
  records: Record<string, Member>;
  checks: Record<string, Signed[]>;
}

const parent = keysParent();
let relay = "";
let dir = "";
let seats: ChannelIdentityView[] = [];
let person: string | null = null;
let mine: string[] = [];
let memory: Memory = { records: {}, checks: {} };
let writing: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const waiting = new Map<number, (d: Done) => void>();

const memoryFile = (): string => path.join(dir, "kiwi-keys-memory.json");

function loadMemory(): void {
  try {
    const v = JSON.parse(fs.readFileSync(memoryFile(), "utf8")) as Partial<Memory> | null;
    memory = { records: v?.records && typeof v.records === "object" ? v.records : {}, checks: v?.checks && typeof v.checks === "object" ? v.checks : {} };
  } catch {
    memory = { records: {}, checks: {} };
  }
}

function writeMemory(): void {
  if (writing) clearTimeout(writing);
  writing = null;
  if (!dir) return;
  try {
    writePrivate(memoryFile(), Buffer.from(JSON.stringify(memory), "utf8"));
  } catch {
    return;
  }
}

function persist(): void {
  if (writing || !dir) return;
  writing = setTimeout(writeMemory, 500);
}

const records: RecordMemory = {
  get: (room, pk) => memory.records[`${room}/${pk}`] ?? null,
  set: (room, pk, m) => {
    memory.records[`${room}/${pk}`] = m;
    persist();
  },
};

const budget: SigningBudget = {
  load: (room) => memory.checks[room] ?? [],
  save: (room, signed) => {
    memory.checks[room] = signed;
    persist();
  },
};

keepRecordsIn(records);

function ask(msg: Ask): Promise<Done> {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    parent.postMessage({ ...msg, id });
  });
}

async function asked(msg: Ask): Promise<Done> {
  const d = await ask(msg);
  if (d.error) throw new Error(d.error);
  return d;
}

const keyring = new Keyring({
  relay: () => relay,
  seats: () => seats,
  save: async (entry) => void (await asked({ type: "save", entry })),
  access: async (code, pk, access) => void (await asked({ type: "access", code, pk, access })),
  forget: async (code) => void (await asked({ type: "forget", code })),
  prove: async (code, memberPk): Promise<JoinClaims | null> => (await asked({ type: "prove", code, memberPk })).claim ?? null,
  githubToken: async () => (await asked({ type: "githubToken" })).token ?? null,
  person: () => person,
  mine: () => mine,
  budget,
  search: () => {
    const worker = ["search.js", "search-worker.ts"].map((f) => path.join(import.meta.dir, f)).find((f) => fs.existsSync(f));
    return dir && worker ? { file: (name) => path.join(dir, "search", name), spawn: () => bunSearchWorker(worker) } : null;
  },
});

function attach(port: PagePort): void {
  const session = serveKeys(keyring, (p) => port.postMessage(p));
  port.on("message", (e) => {
    void session.handle(e.data).then((reply) => {
      if (reply) port.postMessage(reply);
    });
  });
  port.on("close", () => session.close());
  port.start();
}

parent.on("message", (e) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      relay = m.relay;
      dir = m.dir;
      seats = m.seats;
      person = m.person;
      mine = m.mine;
      loadMemory();
      void keyring.finishCreating().catch(() => {});
      return;
    case "seats":
      seats = m.seats;
      person = m.person;
      mine = m.mine;
      if (seats.some((c) => c.creating && !c.access)) void keyring.finishCreating().catch(() => {});
      return;
    case "flush":
      writeMemory();
      parent.postMessage({ type: "flushed", id: 0 });
      return;
    case "relay":
      relay = m.relay;
      return;
    case "nudge":
      keyring.nudge();
      return;
    case "port": {
      const port = e.ports[0];
      if (port) attach(port);
      return;
    }
    case "done":
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
      return;
  }
});
