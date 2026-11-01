import { parseArgs } from "node:util";
import { IDENTITY_ARG, selfIdentity } from "../hooks.ts";
import { QUERY_ARG } from "../query-arg.ts";

if (process.argv[2] === IDENTITY_ARG && process.argv.length === 3) {
  const identity = selfIdentity();
  if (identity === null) process.exit(1);
  process.stdout.write(`${identity}\n`);
  process.exit(0);
}

if (process.argv[2] === QUERY_ARG && process.argv.length === 3) {
  const { runQueryWorker } = await import("../query.ts");
  await runQueryWorker();
  process.exit(0);
}

const isRelay = process.argv[2] === "relay";
const raw = process.argv.slice(2);
const isTaskAdd = raw.some((a, i) => a === "task" && raw[i + 1] === "add");
const argv = isTaskAdd ? raw.map((a) => (a === "--ask" ? "--re" : a.startsWith("--ask=") ? `--re=${a.slice(6)}` : a)) : raw;
const OPTION_TOKEN = /^(-[A-Za-z]+|--[A-Za-z][\w-]*(=[\s\S]*)?)$/;
const texts = new Map<string, string>();
const shielded = (isRelay ? ["relay"] : argv).map((a, i) => {
  if (a.length < 2 || !a.startsWith("-") || a === "--" || OPTION_TOKEN.test(a)) return a;
  const stand = `\u0000${i}`;
  texts.set(stand, a);
  return stand;
});
const back = (v: string): string => texts.get(v) ?? v;
const parsed = parseArgs({
  args: shielded,
  allowPositionals: true,
  options: {
    channel: { type: "string", short: "c" },
    as: { type: "string" },
    nick: { type: "string" },
    quiet: { type: "boolean" },
    role: { type: "string" },
    about: { type: "string" },
    relay: { type: "string" },
    code: { type: "string" },
    to: { type: "string" },
    kind: { type: "string" },
    re: { type: "string" },
    webhook: { type: "string" },
    secret: { type: "string" },
    image: { type: "string", multiple: true },
    option: { type: "string", multiple: true },
    holds: { type: "string" },
    close: { type: "string" },
    step: { type: "boolean" },
    do: { type: "string", multiple: true },
    run: { type: "string", multiple: true },
    expect: { type: "string" },
    link: { type: "string", multiple: true },
    why: { type: "string" },
    "needs-person": { type: "string" },
    wait: { type: "string" },
    handoff: { type: "string" },
    vendor: { type: "string" },
    expires: { type: "string" },
    reveal: { type: "boolean" },
    raw: { type: "boolean" },
    list: { type: "boolean" },
    owner: { type: "string" },
    after: { type: "string" },
    detail: { type: "string" },
    body: { type: "string" },
    goal: { type: "string" },
    issue: { type: "string" },
    from: { type: "string" },
    ttl: { type: "string" },
    label: { type: "string" },
    user: { type: "string" },
    fingerprint: { type: "string" },
    note: { type: "string" },
    on: { type: "string" },
    undo: { type: "boolean" },
    file: { type: "string" },
    at: { type: "string" },
    round: { type: "string" },
    mine: { type: "boolean" },
    "for-me": { type: "boolean" },
    chat: { type: "boolean" },
    thread: { type: "string" },
    all: { type: "boolean" },
    global: { type: "boolean" },
    fresh: { type: "boolean" },
    stale: { type: "boolean" },
    first: { type: "boolean" },
    json: { type: "boolean" },
    schema: { type: "boolean" },
    listen: { type: "boolean" },
    timeout: { type: "string" },
    yes: { type: "boolean", short: "y" },
    push: { type: "boolean" },
    clear: { type: "boolean" },
    force: { type: "boolean" },
    needs: { type: "string" },
    "needs-you": { type: "boolean" },
    review: { type: "string" },
    once: { type: "boolean" },
    now: { type: "boolean" },
    ask: { type: "boolean" },
    escalate: { type: "boolean" },
    task: { type: "string" },
    dm: { type: "string" },
    main: { type: "boolean" },
    model: { type: "string" },
    effort: { type: "string" },
    permission: { type: "string" },
    context: { type: "string" },
    harness: { type: "string" },
    persona: { type: "string" },
    folder: { type: "string" },
    tools: { type: "string" },
    stay: { type: "boolean" },
    room: { type: "string" },
    server: { type: "string" },
    session: { type: "string" },
    pid: { type: "string" },
    block: { type: "string" },
    seat: { type: "string" },
    n: { type: "string", short: "n" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const values = Object.fromEntries(Object.entries(parsed.values).map(([k, v]) => [k, typeof v === "string" ? back(v) : Array.isArray(v) ? v.map(back) : v])) as typeof parsed.values;
const given: ReadonlySet<string> = new Set(Object.entries(values).flatMap(([k, v]) => (v === undefined ? [] : [k])));
const read = new Set<string>();
export const opt = new Proxy(values, {
  get(target, key, receiver) {
    if (typeof key === "string") read.add(key);
    return Reflect.get(target, key, receiver);
  },
});
export const args = parsed.positionals.map(back);

export function ignoredOptions(): string[] {
  return [...given].filter((k) => !read.has(k));
}

export function unexpectedOptions(allowed: readonly string[]): string[] {
  return [...given].filter((k) => !allowed.includes(k));
}
