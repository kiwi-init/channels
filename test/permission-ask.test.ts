import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { Live } from "@kiwi/core/client.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PERMISSION_CHOICES, permissionReply, type PermissionSettled } from "@kiwi/core/permission.ts";
import type { Kind, Message, Payload } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { runAgent } from "../src/agent/shared.ts";
import { askPermission, holdSession, type Asking } from "../src/hooks/permission.ts";
import { pendingCall } from "../src/hooks/permission-call.ts";

const home = mkdtempSync(join(tmpdir(), "kiwi-permission-ask-"));
const was = process.env.KIWI_HOME;
const ids: Record<string, Identity> = {};
let roster: Roster;

beforeAll(async () => {
  process.env.KIWI_HOME = home;
  for (const n of ["ada", "bea", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "ada", pk: ids.ada!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-ada", name: "Ada" } },
    { name: "bea", pk: ids.bea!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: { user: "u-bea", name: "Bea" } },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: { user: "u-bea", name: "Bea" } },
  ];
});

afterAll(() => {
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  rmSync(home, { recursive: true, force: true });
});

type Extra = Partial<Pick<Payload, "id" | "to" | "re" | "esc" | "choices" | "permission" | "perm">>;

function relay(onClose: Effect.Effect<void> = Effect.void) {
  const log: Message[] = [];
  const missing = new Map<number, number>();
  const replies: { re: number; settled: PermissionSettled | undefined }[] = [];
  const frames = Effect.runSync(Queue.unbounded<Live>());
  let withheld = 0;
  const view = () => {
    const messages = log.filter((m) => {
      const left = missing.get(m.seq) ?? 0;
      if (!left) return true;
      missing.set(m.seq, left - 1);
      withheld++;
      return false;
    });
    return { messages, state: fold(messages, roster) };
  };
  const post = async (from: string, kind: Kind, body: string, extra: Extra, readsMissing = 0) => {
    const ts = Date.now();
    const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts });
    const m: Message = { ...p, seq: log.length + 1, rts: ts, sigOk: await verify(p) };
    if (readsMissing) missing.set(m.seq, readsMissing);
    log.push(m);
    return m;
  };
  const session: Asking = {
    me: "dev",
    owe: () => {},
    state: () => Effect.sync(view),
    escalate: (body, _re, _handoff, ask = {}) =>
      Effect.promise(async () => {
        const to = ["bea", "ada"];
        const m = await post("dev", "blocking", body, {
          to,
          esc: true,
          ...(ask.choices ? { choices: ask.choices } : {}),
          ...(ask.id ? { id: ask.id } : {}),
          ...(ask.permission ? { permission: ask.permission } : {}),
        });
        return { seq: m.seq, to };
      }),
    reply: (seq, _body, _kind, _imgs, extra = {}) => Effect.sync(() => (replies.push({ re: seq, settled: extra.settled }), log.length)),
    ch: { fx: { head: () => Effect.succeed(log.length), live: () => Stream.fromQueue(frames).pipe(Stream.ensuring(onClose)) } },
  };
  const answer = async (allow: boolean, readsMissing = 0) => {
    for (let n = 0; n < 200 && !log.some((m) => m.permission); n++) await Bun.sleep(10);
    const ask = log.find((m) => m.permission)!;
    const perm = permissionReply(ask, allow, fold(log, roster))!;
    const m = await post("bea", "msg", allow ? PERMISSION_CHOICES[0] : PERMISSION_CHOICES[1], { to: ["dev"], re: [ask.seq], perm }, readsMissing);
    Effect.runSync(Queue.offer(frames, { _tag: "Message", message: m }));
    return m;
  };
  return { session, replies, answer, withheld: () => withheld };
}

let prompts = 0;
function prompt(session: string) {
  const transcript = join(home, `t${prompts}.jsonl`);
  const id = `toolu_${String(prompts++).padStart(4, "0")}`;
  const input = { command: "touch made.txt", description: "Create a file" };
  writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { id: `msg_${id}`, content: [{ type: "tool_use", id, name: "Bash", input }] } }) + "\n");
  const held = holdSession(session)!;
  return {
    held,
    run: (s: Asking) =>
      runAgent(
        askPermission(s, { tool_name: "Bash", tool_input: input, cwd: "/srv/app" }, pendingCall(transcript, "Bash", input)!, transcript, null, held).pipe(Effect.ensuring(Effect.sync(held.release))),
      ),
  };
}

describe("the permission hook's wait for an answer", () => {
  test("an answer the fold doesn't hold yet when its frame comes is read again until it does, and decided on the fold's copy", async () => {
    const r = relay();
    const p = prompt("sess-lag");
    const decided = p.run(r.session);
    await r.answer(true, 2);
    expect(await decided).toEqual({ decision: "allow", by: "bea" });
    expect(r.withheld()).toBe(2);
  });

  test("a newer prompt that starts while the wait winds down gets nothing printed for the old one: the last check runs after it has closed", async () => {
    const r = relay(Effect.promise(() => Bun.sleep(200)).pipe(Effect.andThen(Effect.sync(() => void holdSession("sess-late")))));
    const p = prompt("sess-late");
    const decided = p.run(r.session);
    await r.answer(false);
    expect(await decided).toBeNull();
    expect(r.replies.map((x) => x.settled)).toEqual(["terminal"]);
  });
});
