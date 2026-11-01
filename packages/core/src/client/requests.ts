import { makePin, pinned, readPin } from "../pin.ts";
import { cleanPersona, personaScopes, type Personality } from "../personality.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { openFrom } from "../crypto.ts";
import { freeHandle, seededPick } from "../handles.ts";
import { signText, verify, verifyText } from "../identity.ts";
import {
  inlineText,
  makeRecord,
  NAME_RE,
  nameKey,
  readLaunch,
  readRuns,
  RESERVED_NAMES,
  sealRecord,
  verifiedComputer,
  verifiedDevice,
  verifiedPerson,
  type JoinClaims,
  type JoinRequest,
  type Member,
  type MemberInfo,
} from "../membership.ts";
import { cleanCard } from "../protocol.ts";
import { BadName, Rejected } from "../refusals.ts";
import { commitTo, joinCheckCode, ownerNonceStatement, spendAuto, type SigningBudget } from "../sas.ts";
import { canPost, scopesOf, wireScopes } from "../scopes.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal, Refused } from "./errors.ts";
import { wasRemoved } from "./info.ts";
import { requestInfo, wrapAllFor } from "./keys.ts";
import type { DeviceList } from "../devices.ts";
import type { Relay } from "./relay.ts";

const deviceName = (members: readonly Pick<Member, "name">[], base: string): string => {
  for (let n = 2; ; n++) {
    const name = `${base.slice(0, 28)}-${n}`;
    if (!members.some((m) => nameKey(m.name) === nameKey(name))) return name;
  }
};

const sameHuman = (members: readonly Member[], person: string, ownerPerson?: string) =>
  members.find((m) => (m.kind === "human" || m.owner) && m.person === person && !m.device) ?? (person === ownerPerson ? members.find((m) => m.owner) : undefined);

const personNameOf = (members: readonly Member[], person: string): string => {
  const m = sameHuman(members, person);
  return m?.display ?? m?.name ?? "someone";
};

const addsAgents = (m: Member) => m.kind === "human" && !m.owner && !!m.addsAgents && !!m.person && canPost(m.later?.scopes ?? scopesOf(m));

export interface RequestsOptions {
  budget?: SigningBudget;
  person?: string;
  mine?: readonly string[] | null;
  lists?: ReadonlyMap<string, DeviceList>;
}

type RequestRow = {
  id: string;
  pk: string;
  xpk: string;
  box: string;
  ts: number;
  commit: string;
  ownerNonce: string | null;
  reveal: string | null;
  sig: string;
  kind?: string;
};

export interface RequestsFx {
  requests(opts?: RequestsOptions): Effect.Effect<JoinRequest[], Refused, Relay>;
  checkRequest(req: Pick<JoinRequest, "id" | "pk" | "commit">): Effect.Effect<void, Refused, Relay>;
  approve(req: JoinRequest, as?: Partial<MemberInfo>, opts?: { person?: string }): Effect.Effect<Member, Refused, Relay>;
  pinPersona(p: Personality): Effect.Effect<string, Refused, Relay>;
  autoApprove(person: string, personalities?: readonly Personality[], mine?: readonly string[] | null, lists?: ReadonlyMap<string, DeviceList>): Effect.Effect<Member[], Refused, Relay>;
  deny(requestId: string): Effect.Effect<void, Refused, Relay>;
}

export class ChannelRequests {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: RequestsFx = {
    requests: Effect.fn("Channel.requests")({ self: this }, function* (this: ChannelRequests, opts: RequestsOptions = {}) {
      yield* this.ch.ownerOnly();
      const { requests } = yield* this.ch.request<{ requests: RequestRow[] }>("/requests", {}, { v: 2 });
      const out: JoinRequest[] = [];
      const everyone = requests.length ? yield* this.ch.fx.members() : [];
      const seats = everyone.filter((m) => m.active && !m.unverified);
      const agentsOf = new Set(seats.flatMap((m) => (addsAgents(m) ? [m.person!] : [])));
      const offered: Pick<Member, "name">[] = [...everyone];
      for (const r of requests) {
        if (!(yield* Effect.promise(() => verify({ room: this.ch.roomId, pk: r.pk, xpk: r.xpk, box: r.box, ts: r.ts, commit: r.commit, sig: r.sig })))) continue;
        const raw = yield* Effect.promise(() => openFrom(this.ch.identity.xsk!, r.box, requestInfo(this.ch.roomId)));
        let info: MemberInfo & JoinClaims = { name: "?" };
        try {
          info = JSON.parse(raw ?? "{}") as typeof info;
        } catch {
          // Info that isn't JSON: the request still shows, named "?".
        }
        const rerooted = (p: string | null | undefined): boolean => !!p && !!opts.lists?.get(p)?.reroots.length;
        const certified = yield* Effect.promise(() => verifiedComputer(this.ch.roomId, r.pk, info.computer));
        const paired = rerooted(certified?.person) ? null : certified;
        const claimed = yield* Effect.promise(() => verifiedPerson(this.ch.roomId, r.pk, info.person));
        const person = rerooted(claimed) ? null : claimed;
        const device = person ? null : yield* Effect.promise(() => verifiedDevice(this.ch.roomId, r.pk, info.device, (p) => opts.lists?.get(p)));
        const app = device && device.as !== "computer" ? device : null;
        const enrolled = device?.as === "computer" ? { pk: device.pk, label: device.label, person: device.person, personName: personNameOf(seats, device.person) } : null;
        const computer = enrolled ?? paired;
        const pin = person || app ? null : yield* Effect.promise(() => readPin(info.pin, this.ch.roomId, this.ch.identity.pk));
        const kind = person || app ? "human" : "agent";
        const launch = kind === "agent" ? readLaunch(info.launch) : undefined;
        const asked = inlineText(info.name, 40);
        const allowed = NAME_RE.test(asked) && !RESERVED_NAMES.has(nameKey(asked));
        const holder = allowed ? seats.find((m) => nameKey(m.name) === nameKey(asked)) : undefined;
        const personName = !!holder && (holder.kind === "human" || holder.owner);
        const auto = kind !== "human" && (info.auto === true || !!holder) ? asked : undefined;
        const free = !!auto && allowed && !offered.some((m) => nameKey(m.name) === nameKey(asked));
        const nick = kind === "human" ? "" : inlineText(info.display, 40) || (auto && !free && allowed && !personName ? asked.replace(/-\d+$/, "") || asked : "");
        if (auto) offered.push({ name: (info.name = free ? asked : freeHandle(offered, seededPick(r.pk))) });
        const forgotten = !enrolled && !!computer && !!opts.person && computer.person === opts.person && !!opts.mine && !opts.mine.includes(computer.pk);
        const own = !!computer && !!opts.person && computer.person === opts.person && !forgotten;
        const same = app ? sameHuman(seats, app.person, opts.person) : undefined;
        const joinsOnItsOwn = own || (kind === "agent" && !!computer && !!opts.person && agentsOf.has(computer.person)) || !!same;
        const spend = joinsOnItsOwn ? undefined : opts.person && !r.reveal ? undefined : opts.budget;
        const check = yield* this.codeCheck(r, spend, joinsOnItsOwn).pipe(Effect.catchCause(() => Effect.succeed(null)));
        if (!check) continue;
        out.push({
          name: inlineText(info.name, 40) || "?",
          kind,
          ...(nick ? { display: nick } : {}),
          id: r.id,
          pk: r.pk,
          xpk: r.xpk,
          ts: r.ts,
          commit: r.commit,
          ...check,
          sponsoredBy: null,
          ...(auto ? { askedAs: auto } : {}),
          ...(computer ? { computer: { ...computer, own, joinsOnItsOwn, ...(forgotten ? { forgotten: true } : {}) } } : {}),
          ...(person ? { person } : {}),
          ...(app ? { device: { ...app, own: !!opts.person && app.person === opts.person, joinsOnItsOwn: !!same, ...(same ? { handle: same.name } : {}) } } : {}),
          ...(cleanCard(info.card) ? { card: cleanCard(info.card)! } : {}),
          ...(kind !== "human" && readRuns(info.runs) ? { runs: readRuns(info.runs)! } : {}),
          ...(pin ? { pin } : {}),
          ...(launch ? { launch } : {}),
        });
      }
      return out;
    }),

    checkRequest: Effect.fn("Channel.checkRequest")({ self: this }, function* (this: ChannelRequests, req: Pick<JoinRequest, "id" | "pk" | "commit">) {
      yield* this.ch.ownerOnly();
      yield* this.signHalf(req.id, ownerNonceStatement(this.ch.roomId, req.pk, req.commit));
    }),

    pinPersona: Effect.fn("Channel.pinPersona")({ self: this }, function* (this: ChannelRequests, p: Personality) {
      yield* this.ch.ownerOnly();
      return yield* Effect.promise(() => makePin(this.ch.identity, this.ch.roomId, p));
    }),

    approve: Effect.fn("Channel.approve")({ self: this }, function* (this: ChannelRequests, req: JoinRequest, as?: Partial<MemberInfo>, opts: { person?: string } = {}) {
      yield* this.ch.ownerOnly();
      if (req.check !== "ready" || !req.code) return yield* new Rejected(`${req.name} hasn't shown its code yet: approve once you've both seen the same 6 digits`);
      const kind = req.kind ?? "agent";
      const members = yield* this.ch.fx.members();
      const ownerName = members.find((m) => m.owner && m.active)?.name;
      const ownerPerson = opts.person ?? members.find((m) => m.owner)?.person;
      const own = !!req.computer && !!ownerPerson && req.computer.person === ownerPerson;
      const device = kind === "human" && !req.person ? req.device : undefined;
      const same = device
        ? sameHuman(
            members.filter((m) => m.active && !m.unverified),
            device.person,
            ownerPerson,
          )
        : undefined;
      let sponsor: MemberInfo["sponsor"];
      if (device) {
        if (same && !as?.name) as = { ...as, name: deviceName(members, same.name) };
        const name = as?.name ?? req.name;
        sponsor = { user: device.person, name: same?.display ?? same?.name ?? name, handle: same?.name ?? name };
      } else if (kind === "human" && req.person) {
        const name = as?.name ?? req.name;
        sponsor = { user: req.person, name, handle: name };
      } else if (req.computer) {
        const c = req.computer;
        if (own) {
          const owner = members.find((m) => m.owner);
          sponsor = { user: c.person, name: owner?.display ?? owner?.name ?? c.personName, ...(ownerName ? { handle: ownerName } : {}) };
        } else {
          const human = members.find((m) => m.active && m.kind === "human" && m.person === c.person);
          sponsor = human ? { user: c.person, name: human.display ?? c.personName, handle: human.name } : { user: c.person, name: c.personName };
        }
      }
      if (kind === "agent" && req.askedAs && !as?.name) {
        as = { ...as, name: members.some((m) => nameKey(m.name) === nameKey(req.name)) ? freeHandle(members, seededPick(req.pk)) : req.name };
      }
      const nick = inlineText(as?.display ?? req.display, 40);
      yield* this.assertNamesFree([as?.name ?? req.name]);
      const persona = kind === "agent" && as?.persona !== undefined ? cleanPersona(as.persona) : undefined;
      if (persona === null) return yield* new Rejected("that personality isn't one a record can carry: check its name, role, capabilities, areas and instructions");
      const inherited = same && !same.owner ? (same.later?.scopes ?? scopesOf(same)) : undefined;
      const scopes = persona ? personaScopes(persona) : (as?.scopes ?? inherited);
      const authority = !!same && (same.owner || !!same.addsAgents);
      const decides = !!same && (same.owner || !!same.answersDecisions);
      const manages = !!same && (same.owner || !!same.managesAgents);
      const info: MemberInfo = {
        name: as?.name ?? req.name,
        kind,
        ...(kind === "human" ? (as?.display ? { display: as.display } : same?.display ? { display: same.display } : {}) : nick ? { display: nick } : {}),
        ...(sponsor ? { sponsor } : {}),
        ...(kind === "human" && req.person ? { person: req.person } : {}),
        ...(device ? { person: device.person, device: { pk: device.pk, label: device.label, as: device.as } } : {}),
        ...(kind === "human" && (as?.addsAgents ?? authority) ? { addsAgents: true } : {}),
        ...(kind === "human" && (as?.answersDecisions ?? decides) ? { answersDecisions: true } : {}),
        ...(kind === "human" && (as?.managesAgents ?? manages) ? { managesAgents: true } : {}),
        ...(kind === "agent" && req.computer ? { from: { pk: req.computer.pk, label: req.computer.label } } : {}),
        ...(kind === "agent" && req.runs ? { runs: req.runs } : {}),
        ...(persona ? { persona } : {}),
        ...(wireScopes(scopes) ? { scopes: wireScopes(scopes)! } : {}),
      };
      const current = this.ch.access.keys[String(this.ch.access.epoch)]!;
      const rec = yield* Effect.promise(() => makeRecord(this.ch.identity, this.ch.roomId, { ...info, pk: req.pk, xpk: req.xpk }));
      const keys = yield* Effect.promise(() => wrapAllFor(this.ch.identity, this.ch.roomId, this.ch.access.keys, req.pk, req.xpk));
      const post = canPost(scopesOf(info));
      const sealed = yield* Effect.promise(() => sealRecord(current, rec));
      const back = wasRemoved(this.ch.roomId, req.pk);
      yield* this.ch.request("/members", { method: "POST", body: JSON.stringify({ pk: req.pk, xpk: req.xpk, rec: sealed, keys, request: req.id, ...(post ? {} : { post }) }) });
      if (back) yield* this.ch.fx.send(`let ${info.name} back in`, { kind: "event", ev: { op: "member.back", member: info.name, pk: req.pk } });
      return { pk: req.pk, xpk: req.xpk, ...info, owner: false, at: rec.at, active: true } satisfies Member;
    }),

    autoApprove: Effect.fn("Channel.autoApprove")(
      { self: this },
      function* (this: ChannelRequests, person: string, personalities: readonly Personality[] = [], mine: readonly string[] | null = null, lists?: ReadonlyMap<string, DeviceList>) {
        yield* this.ch.ownerOnly();
        for (const req of yield* this.ch.fx.requests({ person, mine, lists })) {
          if ((req.computer?.joinsOnItsOwn || req.device?.joinsOnItsOwn) && req.check === "unchecked") yield* Effect.ignoreCause(this.ch.fx.checkRequest(req));
        }
        const approved: Member[] = [];
        const people = yield* this.ch.fx.members();
        for (const req of yield* this.ch.fx.requests({ person, mine, lists })) {
          if (req.device?.joinsOnItsOwn && req.check === "ready" && req.code) {
            const one = yield* Effect.exit(this.ch.fx.approve(req, undefined, { person }));
            if (Exit.isSuccess(one)) approved.push(one.value);
            continue;
          }
          if (!(req.computer?.joinsOnItsOwn && req.check === "ready" && req.code)) continue;
          const pin = req.pin;
          let as: Partial<MemberInfo> | undefined;
          if (req.computer.own) {
            const persona = pin ? yield* Effect.promise(() => pinned(pin, personalities)) : undefined;
            if (persona === null) continue;
            as = persona ? { persona } : undefined;
          } else {
            const sponsor = req.computer.person;
            const human = people.find((m) => m.active && !m.unverified && addsAgents(m) && m.person === sponsor);
            if (!human || pin) continue;
            const scopes = human.later?.scopes ?? scopesOf(human);
            as = wireScopes(scopes) ? { scopes } : undefined;
          }
          const one = yield* Effect.exit(this.ch.fx.approve(req, as, { person }));
          if (Exit.isSuccess(one)) approved.push(one.value);
        }
        return approved;
      },
    ),

    deny: Effect.fn("Channel.deny")({ self: this }, function* (this: ChannelRequests, requestId: string) {
      yield* this.ch.ownerOnly();
      yield* this.ch.request(`/requests/${requestId}/deny`, { method: "POST", body: "{}" });
    }),
  };

  private codeCheck(
    r: { id: string; pk: string; commit: string; ownerNonce: string | null; reveal: string | null },
    budget?: SigningBudget,
    free = false,
  ): Effect.Effect<Pick<JoinRequest, "code" | "check">, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const statement = ownerNonceStatement(this.ch.roomId, r.pk, r.commit);
      const served = r.ownerNonce;
      if (served && !(yield* Effect.promise(() => verifyText(this.ch.access.ownerPk, served, statement)))) throw new Error("not the owner's signature");
      const ownerNonce = served ?? (free || (budget && spendAuto(budget, this.ch.roomId, r.commit)) ? yield* this.signHalf(r.id, statement) : null);
      if (!ownerNonce) return { code: null, check: "unchecked" as const };
      const reveal = r.reveal;
      if (!reveal) return { code: null, check: "waiting" as const };
      if ((yield* Effect.promise(() => commitTo(this.ch.roomId, r.pk, reveal))) !== r.commit) throw new Error("the reveal doesn't match the commit");
      return { code: yield* Effect.promise(() => joinCheckCode(this.ch.roomId, r.pk, ownerNonce, reveal)), check: "ready" as const };
    });
  }

  private signHalf(requestId: string, statement: string): Effect.Effect<string, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const nonce = yield* Effect.promise(() => signText(this.ch.identity, statement));
      yield* this.ch.request(`/requests/${requestId}/nonce`, { method: "POST", body: JSON.stringify({ nonce }) });
      return nonce;
    });
  }

  private assertNamesFree(names: string[]): Effect.Effect<void, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      const taken = new Set((yield* this.ch.fx.members()).filter((m) => m.active).map((m) => nameKey(m.name)));
      const seen = new Set<string>();
      for (const n of names) {
        if (!NAME_RE.test(n)) return yield* new BadName(`"${inlineText(n, 40)}" isn't a valid name (1-32 letters, digits, _ . or -); they need to ask again under another name`);
        if (RESERVED_NAMES.has(nameKey(n))) return yield* new BadName(`"${n}" is a reserved name; they need to ask again under another name`);
        if (taken.has(nameKey(n)) || seen.has(nameKey(n))) return yield* new BadName(`"${n}" is already someone's name in this channel; they need to ask again under another name`);
        seen.add(nameKey(n));
      }
    });
  }
}
