import { freeAgentName, nameKey, RESERVED_NAMES, type Member } from "./membership.ts";

const ANIMALS = [
  "otter",
  "heron",
  "lynx",
  "badger",
  "falcon",
  "panda",
  "koala",
  "gecko",
  "bison",
  "crane",
  "dolphin",
  "ferret",
  "gazelle",
  "hedgehog",
  "ibis",
  "jaguar",
  "kestrel",
  "lemur",
  "marten",
  "narwhal",
  "ocelot",
  "puffin",
  "quokka",
  "raven",
  "stoat",
  "tapir",
  "urchin",
  "vole",
  "walrus",
  "yak",
  "zebra",
  "alpaca",
  "beaver",
  "capybara",
  "dingo",
  "egret",
  "finch",
  "gibbon",
  "hare",
  "impala",
  "jackal",
  "puma",
  "llama",
  "manatee",
  "newt",
  "owl",
  "pelican",
  "robin",
  "salmon",
  "tortoise",
  "wombat",
  "wren",
  "fox",
  "moose",
  "mole",
  "orca",
  "swan",
  "toucan",
  "squid",
  "marmot",
] as const;

const ADJECTIVES = [
  "gentle",
  "brave",
  "bright",
  "calm",
  "clever",
  "cosy",
  "curious",
  "eager",
  "fair",
  "fond",
  "friendly",
  "glad",
  "graceful",
  "happy",
  "honest",
  "humble",
  "jolly",
  "keen",
  "kind",
  "lively",
  "loyal",
  "lucky",
  "merry",
  "mellow",
  "mighty",
  "nimble",
  "noble",
  "patient",
  "plucky",
  "polite",
  "proud",
  "quick",
  "quiet",
  "radiant",
  "sincere",
  "smart",
  "snug",
  "spry",
  "steady",
  "sunny",
  "swift",
  "tidy",
  "trusty",
  "upbeat",
  "warm",
  "wise",
  "witty",
  "zesty",
  "bold",
  "cheery",
  "daring",
  "earnest",
  "festive",
  "gallant",
  "hearty",
  "jovial",
  "lucid",
  "serene",
  "sparkly",
  "tender",
] as const;

function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % n;
}

export function seededPick(seed: string): (n: number) => number {
  let h = 0x811c9dc5;
  for (const ch of seed) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return (n: number) => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

function randomHandle(pick: (n: number) => number = randomIndex): string {
  const adjective = ADJECTIVES[pick(ADJECTIVES.length)];
  return `${adjective}-${ANIMALS[pick(ANIMALS.length)]}`;
}

export function freeHandle(members: readonly Pick<Member, "name">[], pick: (n: number) => number = randomIndex): string {
  const taken = new Set(members.map((m) => nameKey(m.name)));
  for (let i = 0; i < 64; i++) {
    const h = randomHandle(pick);
    if (!taken.has(nameKey(h)) && !RESERVED_NAMES.has(nameKey(h))) return h;
  }
  return freeAgentName(randomHandle(pick), members);
}
