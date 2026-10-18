import { cleanPersona, personaScopes } from "../personality.ts";
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
  readRuns,
  RESERVED_NAMES,
  sealRecord,
  verifiedComputer,
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
import { isLeadRole } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal, Refused } from "./errors.ts";
import { requestInfo, wrapAllFor } from "./keys.ts";
import type { Relay } from "./relay.ts";

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
  requests(opts?: { budget?: SigningBudget; person?: string }): Effect.Effect<JoinRequest[], Refused, Relay>;
  checkRequest(req: Pick<JoinRequest, "id" | "pk" | "commit">): Effect.Effect<void, Refused, Relay>;
  approve(req: JoinRequest, as?: Partial<MemberInfo>, opts?: { person?: string }): Effect.Effect<Member, Refused, Relay>;
  autoApprove(person: string): Effect.Effect<Member[], Refused, Relay>;
  deny(requestId: string): Effect.Effect<void, Refused, Relay>;
}

export class ChannelRequests {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: RequestsFx = {
    requests: Effect.fn("Channel.requests")({ self: this }, function* (this: ChannelRequests, opts: { budget?: SigningBudget; person?: string } = {}) {
      yield* this.ch.ownerOnly();
      const { requests } = yield* this.ch.request<{ requests: RequestRow[] }>("/requests", {}, { v: 2 });
      const out: JoinRequest[] = [];
      const everyone = requests.length ? yield* this.ch.fx.members() : [];
      const seats = everyone.filter((m) => m.active && !m.unverified);
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
        const computer = yield* Effect.promise(() => verifiedComputer(this.ch.roomId, r.pk, info.computer));
        const person = yield* Effect.promise(() => verifiedPerson(this.ch.roomId, r.pk, info.person));
        const kind = person ? "human" : "agent";
        const asked = inlineText(info.name, 40);
        const allowed = NAME_RE.test(asked) && !RESERVED_NAMES.has(nameKey(asked));
        const holder = allowed ? seats.find((m) => nameKey(m.name) === nameKey(asked)) : undefined;
        const personName = !!holder && (holder.kind === "human" || holder.owner);
        const auto = kind !== "human" && (info.auto === true || !!holder) ? asked : undefined;
        const free = !!auto && allowed && !offered.some((m) => nameKey(m.name) === nameKey(asked));
        const nick = kind === "human" ? "" : inlineText(info.display, 40) || (auto && !free && allowed && !personName ? asked.replace(/-\d+$/, "") || asked : "");
        if (auto) offered.push({ name: (info.name = free ? asked : freeHandle(offered, seededPick(r.pk))) });
        const own = !!computer && !!opts.person && computer.person === opts.person;
        const spend = own ? undefined : opts.person && !r.reveal ? undefined : opts.budget;
        const check = yield* this.codeCheck(r, spend, own).pipe(Effect.catchCause(() => Effect.succeed(null)));
        if (!check) continue;
        out.push({
          name: inlineText(info.name, 40) || "?",
          role: inlineText(info.role, 60) || undefined,
          about: inlineText(info.about, 200) || undefined,
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
          ...(computer ? { computer: { ...computer, own: opts.person === computer.person } } : {}),
          ...(person ? { person } : {}),
          ...(cleanCard(info.card) ? { card: cleanCard(info.card)! } : {}),
          ...(kind !== "human" && readRuns(info.runs) ? { runs: readRuns(info.runs)! } : {}),
        });
      }
      return out;
    }),

    checkRequest: Effect.fn("Channel.checkRequest")({ self: this }, function* (this: ChannelRequests, req: Pick<JoinRequest, "id" | "pk" | "commit">) {
      yield* this.ch.ownerOnly();
      yield* this.signHalf(req.id, ownerNonceStatement(this.ch.roomId, req.pk, req.commit));
    }),

    approve: Effect.fn("Channel.approve")({ self: this }, function* (this: ChannelRequests, req: JoinRequest, as?: Partial<MemberInfo>, opts: { person?: string } = {}) {
      yield* this.ch.ownerOnly();
      if (req.check !== "ready" || !req.code) return yield* new Rejected(`${req.name} hasn't shown its code yet: approve once you've both seen the same 6 digits`);
      const kind = req.kind ?? "agent";
      const members = yield* this.ch.fx.members();
      const ownerName = members.find((m) => m.owner && m.active)?.name;
      const ownerPerson = opts.person ?? members.find((m) => m.owner)?.person;
      const own = !!req.computer && !!ownerPerson && req.computer.person === ownerPerson;
      let sponsor: MemberInfo["sponsor"];
      if (kind === "human" && req.person) {
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
      const scopes = persona ? personaScopes(persona) : as?.scopes;
      const info: MemberInfo = {
        name: as?.name ?? req.name,
        role: as?.role ?? (isLeadRole(req.role) ? undefined : req.role),
        about: as?.about ?? req.about,
        kind,
        ...(kind === "human" ? (as?.display ? { display: as.display } : {}) : nick ? { display: nick } : {}),
        ...(sponsor ? { sponsor } : {}),
        ...(kind === "human" && req.person ? { person: req.person } : {}),
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
      yield* this.ch.request("/members", { method: "POST", body: JSON.stringify({ pk: req.pk, xpk: req.xpk, rec: sealed, keys, request: req.id, ...(post ? {} : { post }) }) });
      return { pk: req.pk, xpk: req.xpk, ...info, owner: false, at: rec.at, active: true } satisfies Member;
    }),

    autoApprove: Effect.fn("Channel.autoApprove")({ self: this }, function* (this: ChannelRequests, person: string) {
      yield* this.ch.ownerOnly();
      for (const req of yield* this.ch.fx.requests({ person })) {
        if (req.computer?.own && req.check === "unchecked") yield* Effect.ignoreCause(this.ch.fx.checkRequest(req));
      }
      const approved: Member[] = [];
      for (const req of yield* this.ch.fx.requests({ person })) {
        if (!(req.computer?.own && req.check === "ready" && req.code)) continue;
        const one = yield* Effect.exit(this.ch.fx.approve(req, undefined, { person }));
        if (Exit.isSuccess(one)) approved.push(one.value);
      }
      return approved;
    }),

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
