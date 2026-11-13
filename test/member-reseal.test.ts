import { describe, expect, spyOn, test } from "bun:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Channel } from "@kiwi/core/client.ts";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { newChannelKey, openWith, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { makeDelegation } from "@kiwi/core/delegation.ts";
import { generateIdentity, verify, type Identity } from "@kiwi/core/identity.ts";
import { readRecord, type Member } from "@kiwi/core/membership.ts";
import type { Persona } from "@kiwi/core/personality.ts";
import { ChannelCore } from "@kiwi/core/client/core.ts";
import { ChannelInfo } from "@kiwi/core/client/info.ts";
import { ChannelMembers } from "@kiwi/core/client/members.ts";
import { ChannelDelegations } from "@kiwi/core/client/delegations.ts";
import type { Refused } from "@kiwi/core/client/errors.ts";
import { fetchRelay, Relay } from "@kiwi/core/client/relay.ts";
import { BaseMembers, BaseDelegations, MEMBER_RESEAL_BASE } from "./fixtures/member-reseal.ts";

const NOW = 1_790_000_000_000;
const ROOM = "a".repeat(32);
const owner = await generateIdentity("owner");
const agent = await generateIdentity("agent");
const computer = await generateIdentity("computer");
const olderKey = newChannelKey();
const currentKey = newChannelKey();

function exchange(id: Identity): string {
  if (!id.xpk) throw new Error("test identity has no exchange key");
  return id.xpk;
}

const delegation = await makeDelegation(owner, ROOM, { pk: computer.pk, xpk: exchange(computer) }, owner.pk, NOW);
const READER: Persona = { name: "Reader", role: "reviewer", capabilities: ["review"], areas: ["packages/core"], instructions: "Read carefully." };
const WRITER: Persona = { name: " Writer ", role: "builder", capabilities: ["write", "tasks", "write"], areas: [" src/ ", "src/"], instructions: "Build carefully." };

function member(kind: "agent" | "human" = "agent"): Member {
  return {
    name: "agent",
    pk: agent.pk,
    xpk: exchange(agent),
    kind,
    owner: false,
    active: true,
    unverified: false,
    readOnly: true,
    at: 123,
    role: "old role",
    about: "old instructions",
    display: "old nickname",
    scopes: ["post"],
    later: { scopes: [], since: 11 },
    laterRole: { role: "reviewer", about: "older", since: 10 },
    sponsor: { user: owner.pk, name: "Owner" },
    from: { pk: computer.pk, label: "computer" },
    person: owner.pk,
    device: { pk: computer.pk, label: "desktop", as: "desktop" },
    color: "blue",
    addsAgents: true,
    answersDecisions: true,
    managesAgents: true,
    runs: { harness: "codex", model: "test-model" },
    persona: READER,
  };
}

type Updates = BaseMembers["fx"];
type Adoption = BaseDelegations["fx"];
type Version = "base" | "head";
interface Action {
  name: string;
  kind: "agent" | "human";
  run: (fx: Updates, m: Member) => Effect.Effect<void, Refused, Relay>;
}

const actions: Action[] = [
  { name: "scopes post", kind: "agent", run: (fx, m) => fx.updateScopes(m, ["post"], 50) },
  { name: "scopes read-only", kind: "agent", run: (fx, m) => fx.updateScopes(m, [], 50) },
  { name: "persona set reader", kind: "agent", run: (fx, m) => fx.updatePersona(m, READER, 50) },
  { name: "persona set/clean writer", kind: "agent", run: (fx, m) => fx.updatePersona(m, WRITER, 50) },
  { name: "persona clear", kind: "agent", run: (fx, m) => fx.updatePersona(m, null, 50) },
  { name: "role omitted about", kind: "agent", run: (fx, m) => fx.updateRole(m, "builder", undefined, 50) },
  { name: "role null about", kind: "agent", run: (fx, m) => fx.updateRole(m, "builder", null, 50) },
  { name: "role empty about", kind: "agent", run: (fx, m) => fx.updateRole(m, "builder", "", 50) },
  { name: "role changed about", kind: "agent", run: (fx, m) => fx.updateRole(m, "builder", "new instructions", 50) },
  { name: "role clear", kind: "agent", run: (fx, m) => fx.updateRole(m, null, undefined, 50) },
  { name: "nickname clear", kind: "agent", run: (fx, m) => fx.updateNickname(m, null) },
  { name: "nickname empty", kind: "agent", run: (fx, m) => fx.updateNickname(m, " \n ") },
  { name: "nickname normalize", kind: "agent", run: (fx, m) => fx.updateNickname(m, "  new\u0000 nickname\u202e ") },
  { name: "nickname truncate", kind: "agent", run: (fx, m) => fx.updateNickname(m, "x".repeat(120)) },
  { name: "powers omitted", kind: "human", run: (fx, m) => fx.updatePowers(m, {}) },
  { name: "powers false", kind: "human", run: (fx, m) => fx.updatePowers(m, { addsAgents: false, answersDecisions: false, managesAgents: false }) },
  { name: "powers true", kind: "human", run: (fx, m) => fx.updatePowers(m, { addsAgents: true, answersDecisions: true, managesAgents: true }) },
  { name: "powers mixed", kind: "human", run: (fx, m) => fx.updatePowers(m, { answersDecisions: false }) },
];

function errorInfo(value: unknown) {
  return {
    name: value instanceof Error ? value.name : typeof value,
    message: value instanceof Error ? value.message : String(value),
    tag: typeof value === "object" && value !== null && "_tag" in value ? value._tag : null,
    status: typeof value === "object" && value !== null && "status" in value ? value.status : null,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
  return Object.fromEntries(Object.entries(value));
}

interface Options {
  principal?: "owner" | "other";
  key?: "present" | "missing";
  status?: number;
  afterSign?: (rows: Member[], core: ChannelCore) => void;
}

async function observe(version: Version, rows: Member[], run: (fx: { updates: Updates; adoption: Adoption }, rows: Member[]) => Effect.Effect<unknown, Refused, Relay>, options: Options = {}) {
  const access: ChannelAccess = { roomId: ROOM, ownerPk: owner.pk, ownerXpk: exchange(owner), epoch: 7, keys: options.key === "missing" ? { "1": olderKey } : { "1": olderKey, "7": currentKey } };
  const identity = options.principal === "other" ? agent : owner;
  const core = new ChannelCore(access, "http://relay.invalid", identity);
  const copied = structuredClone(rows);
  const reads: string[] = [];
  core.fx = {
    ...new Channel(access, "http://relay.invalid", identity).fx,
    members: () =>
      Effect.sync(() => {
        reads.push("members");
        return copied;
      }),
    delegations: () =>
      Effect.sync(() => {
        reads.push("delegations");
        return [delegation];
      }),
  };
  const fx =
    version === "base"
      ? { updates: new BaseMembers(core).fx, adoption: new BaseDelegations(core).fx }
      : { updates: new ChannelMembers(core, new ChannelInfo(core, {})).fx, adoption: new ChannelDelegations(core).fx };
  const calls: { path: string; method: string; body: string; token: string }[] = [];
  let signs = 0;
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  const signing = spyOn(crypto.subtle, "sign").mockImplementation((...args: Parameters<typeof originalSign>) => {
    signs++;
    if (signs === 1) options.afterSign?.(copied, core);
    return originalSign(...args);
  });
  const clock = spyOn(Date, "now").mockReturnValue(NOW);
  const fetching = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[input, init]: Parameters<typeof fetch>) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        calls.push({
          path: url.pathname.replace(`/v1/rooms/${ROOM}`, ""),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
          token: new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "",
        });
        return new Response(options.status ? '{"error":"request failed"}' : "{}", { status: options.status ?? 200 });
      },
      { preconnect: () => {} },
    ),
  );
  try {
    const exit = await Effect.runPromiseExit(Effect.provideService(run(fx, copied), Relay, fetchRelay));
    const outcome = Exit.isSuccess(exit)
      ? { kind: "success", value: exit.value }
      : {
          kind: "error",
          reasons: exit.cause.reasons.map((reason) => {
            if (Cause.isFailReason(reason)) return { kind: "failure", error: errorInfo(reason.error) };
            if (Cause.isDieReason(reason)) return { kind: "defect", error: errorInfo(reason.defect) };
            return { kind: "interrupt" };
          }),
        };
    const records = await Promise.all(
      calls.map(async (call) => {
        const payload = object(JSON.parse(call.body));
        if (typeof payload.rec !== "string" || typeof payload.e !== "number" || typeof payload.post !== "boolean") throw new Error("unexpected request shape");
        const raw = await openWith(currentKey, payload.rec, `mc-member\n${ROOM}`);
        if (!raw) throw new Error("record was not sealed with the current key");
        const record = object(JSON.parse(raw));
        if (typeof record.member !== "string") throw new Error("record has no member key");
        const checked = await readRecord(currentKey, payload.rec, ROOM, record.member, owner.pk);
        expect(await verify(record)).toBe(true);
        expect(checked?.signer).toBe(owner.pk);
        expect(record).toMatchObject({ room: ROOM, pk: owner.pk, member: agent.pk, mxpk: exchange(agent), at: NOW });
        expect(record).not.toHaveProperty("active");
        expect(record).not.toHaveProperty("readOnly");
        expect(record).not.toHaveProperty("unverified");
        expect(record).not.toHaveProperty("signedBy");
        expect(payload.e).toBe(7);
        expect(await openWith(olderKey, payload.rec, `mc-member\n${ROOM}`)).toBeNull();
        const requestSigner = await verifyRequest(call.token, ROOM, call.method, call.path, call.body, NOW);
        expect(requestSigner).toBe(owner.pk);
        return { path: call.path, method: call.method, e: payload.e, post: payload.post, record, requestSigner };
      }),
    );
    return { outcome, signs, reads, records };
  } finally {
    fetching.mockRestore();
    clock.mockRestore();
    signing.mockRestore();
  }
}

async function update(version: Version, action: Action, target: Member, options: Options = {}) {
  return observe(
    version,
    [target],
    ({ updates }, rows) => {
      const row = rows[0];
      if (!row) throw new Error("missing fixture member");
      return action.run(updates, row);
    },
    options,
  );
}

const posting: Pick<Member, "scopes" | "later">[] = [
  { scopes: ["post"], later: undefined },
  { scopes: [], later: { scopes: ["post"], since: 12 } },
  { scopes: ["post"], later: { scopes: [], since: 12 } },
];

describe(`member records match original callers at ${MEMBER_RESEAL_BASE}`, () => {
  for (const action of actions) {
    test(action.name, async () => {
      for (const policy of posting) {
        const target = { ...member(action.kind), ...policy };
        const before = await update("base", action, target);
        const after = await update("head", action, target);
        expect(after).toEqual(before);
        expect(after.outcome).toEqual({ kind: "success", value: undefined });
        expect(after.signs).toBe(2);
        expect(after.records).toHaveLength(1);
        expect(after.records[0]).toMatchObject({ method: "PUT", path: `/members/${agent.pk}/record` });
      }
    });
  }
});

const representative: Action[] = [actions[0], actions[2], actions[5], actions[10], actions[14]].filter((value): value is Action => value !== undefined);

describe("authorization and missing-key exits", () => {
  for (const action of representative) {
    const forbidden: Member = action.name.startsWith("powers")
      ? member("agent")
      : action.name.startsWith("persona") || action.name.startsWith("nickname")
        ? member("human")
        : { ...member(), owner: true };
    for (const [label, target, principal] of [
      ["non-owner and unverified forbidden target", { ...forbidden, unverified: true }, "other"],
      ["non-owner and forbidden target", forbidden, "other"],
      ["unverified and forbidden target", { ...forbidden, unverified: true }, "owner"],
      ["unverified and owner target", { ...member(action.kind), owner: true, unverified: true }, "owner"],
      ["verified owner target", { ...member(action.kind), owner: true }, "owner"],
      ["method-specific forbidden target", forbidden, "owner"],
    ] as const) {
      test(`${action.name}: ${label}`, async () => {
        const before = await update("base", action, target, { principal });
        const after = await update("head", action, target, { principal });
        expect(after).toEqual(before);
        expect(after.outcome).toMatchObject({ kind: "error", reasons: [{ kind: "failure", error: { tag: principal === "other" ? "OwnerOnly" : "Rejected" } }] });
        expect(after.signs).toBe(0);
        expect(after.reads).toEqual([]);
        expect(after.records).toHaveLength(0);
      });
    }
    test(`${action.name}: missing current key remains a defect`, async () => {
      const before = await update("base", action, member(action.kind), { key: "missing" });
      const after = await update("head", action, member(action.kind), { key: "missing" });
      expect(after).toEqual(before);
      expect(after.outcome).toMatchObject({ kind: "error", reasons: [{ kind: "defect" }] });
      expect(after.signs).toBe(1);
      expect(after.records).toHaveLength(0);
    });
  }

  test("invalid persona refusal follows owner and unverified checks", async () => {
    const invalid: Action = { name: "invalid persona", kind: "agent", run: (fx, m) => fx.updatePersona(m, { ...READER, name: "" }, 50) };
    for (const principal of ["owner", "other"] as const) {
      for (const unverified of [false, true]) {
        const target = { ...member(), unverified };
        const before = await update("base", invalid, target, { principal });
        const after = await update("head", invalid, target, { principal });
        expect(after).toEqual(before);
        expect(after.outcome).toMatchObject({ kind: "error" });
        expect(after.signs).toBe(0);
        expect(after.records).toHaveLength(0);
      }
    }
  });

  test("relay refusal remains a typed failure after the same signed PUT", async () => {
    const action = representative[0];
    if (!action) throw new Error("missing representative action");
    const before = await update("base", action, member(), { status: 503 });
    const after = await update("head", action, member(), { status: 503 });
    expect(after).toEqual(before);
    expect(after.outcome).toMatchObject({ kind: "error", reasons: [{ kind: "failure", error: { status: 503 } }] });
  });

  test("posting is calculated after signing while epoch/key remain captured", async () => {
    const action: Action = { name: "role", kind: "agent", run: (fx, m) => fx.updateRole(m, "builder", undefined, 50) };
    const options: Options = {
      afterSign: (rows, core) => {
        const row = rows[0];
        if (row) row.later = { scopes: ["post"], since: 99 };
        core.access.epoch = 1;
      },
    };
    const before = await update("base", action, member(), options);
    const after = await update("head", action, member(), options);
    expect(after).toEqual(before);
    expect(after.records[0]).toMatchObject({ e: 7, post: true, record: { later: { scopes: [], since: 11 } } });
  });
});

const adopt = ({ adoption }: { adoption: Adoption }) => adoption.tendDelegations([{ pk: computer.pk, xpk: exchange(computer) }], owner.pk);

describe("delegation adoption keeps its distinct policy", () => {
  for (const readOnly of [false, true]) {
    test(`readOnly ${readOnly} disagrees with pending scopes`, async () => {
      const row = { ...member(), signedBy: computer.pk, readOnly, later: { scopes: readOnly ? ["post"] : [], since: 22 } } satisfies Member;
      const before = await observe("base", [row], adopt);
      const after = await observe("head", [row], adopt);
      expect(after).toEqual(before);
      expect(after.outcome).toEqual({ kind: "success", value: { issued: [], dropped: [], adopted: [agent.pk] } });
      expect(after.records[0]?.post).toBe(!readOnly);
      expect(after.signs).toBe(2);
    });
  }
  const skipped: Member[] = [
    { ...member(), signedBy: computer.pk, active: false },
    { ...member(), signedBy: computer.pk, unverified: true },
    { ...member(), signedBy: computer.pk, owner: true },
    { ...member(), signedBy: undefined },
    { ...member(), signedBy: owner.pk },
  ];
  for (const [index, row] of skipped.entries()) {
    test(`skipped member ${index} produces no signing or PUT`, async () => {
      const before = await observe("base", [row], adopt);
      const after = await observe("head", [row], adopt);
      expect(after).toEqual(before);
      expect(after.outcome).toEqual({ kind: "success", value: { issued: [], dropped: [], adopted: [] } });
      expect(after.signs).toBe(0);
      expect(after.records).toHaveLength(0);
    });
  }
  for (const key of ["present", "missing"] as const) {
    test(`adoption key ${key} preserves authorization/failure order`, async () => {
      const row = { ...member(), signedBy: computer.pk };
      for (const principal of ["owner", "other"] as const) {
        const before = await observe("base", [row], adopt, { key, principal });
        const after = await observe("head", [row], adopt, { key, principal });
        expect(after).toEqual(before);
        if (principal === "other") {
          expect(after.outcome).toMatchObject({ kind: "error", reasons: [{ kind: "failure", error: { tag: "OwnerOnly" } }] });
          expect(after.signs).toBe(0);
          expect(after.reads).toEqual([]);
          expect(after.records).toHaveLength(0);
        } else if (key === "missing") {
          expect(after.outcome).toMatchObject({ kind: "error", reasons: [{ kind: "defect" }] });
          expect(after.records).toHaveLength(0);
        }
      }
    });
  }
});
