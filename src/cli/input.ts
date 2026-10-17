import * as Effect from "effect/Effect";
import type { AgentSession, Delivery } from "../agent.ts";
import { loadImages } from "../attach.ts";
import { formatMessage } from "@kiwi/core/format.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { parseTaskId, type ChannelState } from "@kiwi/core/state.ts";
import { args, opt } from "./args.ts";
import { acting, die, Quit } from "./context.ts";

export function render(m: Message, state?: ChannelState | null): string {
  return opt.json
    ? JSON.stringify({ ...m, ...(m.handoff ? { handoff: { vendor: m.handoff.vendor, expiresAt: m.handoff.expiresAt } } : {}), trust: state?.trust.get(m.seq) })
    : formatMessage(m, state?.trust.get(m.seq), state ?? undefined, acting.name);
}

export const delivery = Effect.fn("kiwi.delivery")(function* (s: AgentSession) {
  const thread = opt.thread === undefined ? undefined : Number(opt.thread.replace(/^#/, "")) || (yield* die("--thread takes a message number"));
  const room = opt.room === undefined ? undefined : yield* s.roomId(opt.room);
  const d: Delivery = { forMe: opt["for-me"], chat: opt.chat, all: opt.all, ...(thread !== undefined ? { thread } : {}), ...(room !== undefined ? { room } : {}) };
  return d;
});

export function list(s: string | undefined): string[] | undefined {
  const items = s
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

export const images = Effect.suspend(() => {
  const v = opt.image as string | string[] | undefined;
  const paths = Array.isArray(v) ? v : v ? [v] : [];
  if (!paths.length) return Effect.succeed(undefined);
  return Effect.try({ try: () => loadImages(paths), catch: (err) => new Quit({ message: err instanceof Error ? err.message : String(err), code: 1 }) });
});

export const taskArg = Effect.fn("kiwi.taskArg")(function* (i = 2) {
  const raw = args[i] ?? (yield* die(`usage: kiwi task ${args[1]} T<id>`));
  return parseTaskId(raw) ?? (yield* die(`"${raw}" isn't a task id (like T12)`));
});

export const readText = (file: string) =>
  Effect.tryPromise({
    try: () => Bun.file(file).text(),
    catch: (err) => new Quit({ message: `can't read ${file}: ${err instanceof Error ? err.message : String(err)}`, code: 1 }),
  }).pipe(Effect.map((t) => t.replace(/\n$/, "")));

const fileText = (from: number, file: string) => (args.length > from ? die("give the text as words or with --file, not both") : readText(file));

export const firstLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 200);

export const text = (from: number) =>
  opt.file !== undefined
    ? fileText(from, opt.file)
    : Effect.promise(async () => {
        if (args.length > from && args[from] !== "-") return args.slice(from).join(" ");
        if (args[from] !== "-" && process.stdin.isTTY) return "";
        return (await new Response(Bun.stdin.stream()).text()).replace(/\n$/, "");
      });

export const confirm = (question: string) =>
  Effect.promise(async () => {
    if (opt.yes) return true;
    if (!process.stdin.isTTY) return false;
    process.stdout.write(`${question} [y/N] `);
    for await (const line of console) return /^y(es)?$/i.test(line.trim());
    return false;
  });
