import * as Effect from "effect/Effect";
import { keepSeen } from "../crypto.ts";
import type { Member } from "../membership.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import {
  MAX_SECRETS,
  newSecretId,
  openSecret,
  sealSecret,
  SECRET_ID_RE,
  secretNameProblem,
  secretNote,
  secretValueProblem,
  type Secret,
  type SecretPlain,
  type SecretRow,
  type SecretView,
} from "../secrets.ts";
import type { ChannelCore } from "./core.ts";
import { RelayError, type Refused } from "./errors.ts";
import type { Relay } from "./relay.ts";

export interface SecretInput {
  id?: string;
  name: string;
  value?: string;
  note?: string | null;
  grants: readonly string[];
}

export interface SecretsFx {
  mySecrets(): Effect.Effect<Secret[], Refused, Relay>;
  secrets(): Effect.Effect<SecretView[], Refused, Relay>;
  secretValue(id: string): Effect.Effect<string, Refused, Relay>;
  setSecret(input: SecretInput): Effect.Effect<SecretView, Refused, Relay>;
  deleteSecret(id: string): Effect.Effect<void, Refused, Relay>;
}

const grantable = (m: Member): boolean => m.active && !m.unverified && !m.owner && m.kind !== "human";

type Held = SecretPlain & { sealed: string };

const view = (p: SecretPlain): SecretView => ({ id: p.id, name: p.name, note: p.note ?? null, rev: p.rev, at: p.at, grants: p.grants ?? [], had: p.had ?? p.grants ?? [] });

const NO_SECRETS = "this relay doesn't keep secrets yet: whoever runs it needs to update it";

const short = (pk: string) => `${pk.slice(0, 8)}…`;

export class ChannelSecrets {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: SecretsFx = {
    mySecrets: Effect.fn("Channel.mySecrets")({ self: this }, function* (this: ChannelSecrets) {
      return (yield* this.held()).map((p): Secret => ({ id: p.id, name: p.name, value: p.value, note: p.note ?? null, rev: p.rev, at: p.at, sealed: p.sealed }));
    }),

    secrets: Effect.fn("Channel.secrets")({ self: this }, function* (this: ChannelSecrets) {
      yield* this.ch.ownerOnly();
      return (yield* this.held()).map(view);
    }),

    secretValue: Effect.fn("Channel.secretValue")({ self: this }, function* (this: ChannelSecrets, id: string) {
      yield* this.ch.ownerOnly();
      const p = (yield* this.held()).find((s) => s.id === id);
      if (!p) return yield* new Rejected("no such secret: it may have been deleted");
      return p.value;
    }),

    setSecret: Effect.fn("Channel.setSecret")({ self: this }, function* (this: ChannelSecrets, input: SecretInput) {
      yield* this.ch.ownerOnly();
      const owner = this.ch.identity;
      if (!owner.xpk) return yield* new MissingKey("this owner key has no exchange key to keep its own copy of a secret with");
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const badName = secretNameProblem(name);
      if (badName) return yield* new Rejected(badName);
      const badValue = input.value === undefined ? null : typeof input.value === "string" ? secretValueProblem(input.value) : "a secret's value is text";
      if (badValue) return yield* new Rejected(badValue);
      if (input.id !== undefined && !SECRET_ID_RE.test(input.id)) return yield* new Rejected("no such secret: it may have been deleted");
      const held = yield* this.held();
      const was = input.id === undefined ? undefined : held.find((s) => s.id === input.id);
      if (input.id !== undefined && !was) return yield* new Rejected("no such secret: it may have been deleted");
      if (held.some((s) => s.name === name && s.id !== was?.id)) return yield* new Rejected(`there is already a secret named ${name}`);
      if (!was && held.length >= MAX_SECRETS) return yield* new Rejected(`a channel keeps at most ${MAX_SECRETS} secrets`);
      const value = input.value ?? was?.value;
      if (value === undefined) return yield* new Rejected("a new secret needs its value");
      const agents = (yield* this.ch.fx.members()).filter(grantable);
      const grants = [...new Set(Array.isArray(input.grants) ? input.grants : [])];
      const stranger = grants.find((pk) => !agents.some((m) => m.pk === pk));
      if (stranger !== undefined) return yield* new Rejected(`${typeof stranger === "string" ? short(stranger) : "that"} isn't an agent in this channel: a secret goes only to agents you let in`);
      const id = was?.id ?? newSecretId();
      const rev = Math.max(was?.rev ?? 0, this.ch.access.seenSecrets?.[id] ?? 0) + 1;
      const note = secretNote(input.note === undefined ? was?.note : input.note);
      const kept = was !== undefined && was.value === value ? (was.had ?? was.grants ?? []) : [];
      const had = [...new Set([...kept, ...grants])];
      const base = { v: 1 as const, room: this.ch.roomId, id, name, value, ...(note ? { note } : {}), rev, at: Math.max(Date.now(), (was?.at ?? 0) + 1) };
      const mine: SecretPlain = { ...base, to: owner.pk, grants, had };
      const boxes = yield* Effect.promise(async () => {
        const out: Record<string, string> = {};
        for (const m of agents) if (grants.includes(m.pk)) out[m.pk] = await sealSecret(owner, m, { ...base, to: m.pk });
        out[owner.pk] = await sealSecret(owner, { pk: owner.pk, xpk: owner.xpk! }, mine);
        return out;
      });
      const r = yield* this.ch.request<{ held?: unknown }>(`/secrets/${id}`, { method: "PUT", body: JSON.stringify({ boxes }) }).pipe(Effect.mapError(older));
      const extra = (Array.isArray(r.held) ? r.held : []).filter((pk): pk is string => typeof pk === "string" && !(pk in boxes));
      this.note([mine]);
      if (extra.length)
        return yield* new Rejected(`the relay says it still keeps this secret for ${extra.map(short).join(", ")}, which it was told to drop: that's the relay's doing; ask whoever runs it`);
      return view(mine);
    }),

    deleteSecret: Effect.fn("Channel.deleteSecret")({ self: this }, function* (this: ChannelSecrets, id: string) {
      yield* this.ch.ownerOnly();
      if (!SECRET_ID_RE.test(id)) return yield* new Rejected("no such secret: it may have been deleted");
      yield* this.ch.request(`/secrets/${id}`, { method: "DELETE" }).pipe(Effect.mapError(older));
    }),
  };

  private held(): Effect.Effect<Held[], Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      const r = yield* this.ch.request<{ secrets?: unknown }>("/secrets").pipe(Effect.mapError(older));
      const rows = (Array.isArray(r.secrets) ? r.secrets : []).slice(0, MAX_SECRETS * 2) as SecretRow[];
      const floor = this.ch.access.seenSecrets ?? {};
      const opened = yield* Effect.promise(() =>
        Promise.all(
          rows.map(async (row): Promise<Held | null> => {
            const p = await openSecret(this.ch.identity, this.ch.roomId, this.ch.access.ownerPk, row);
            return p && { ...p, sealed: row.box };
          }),
        ),
      );
      const newest = new Map<string, Held>();
      for (const p of opened) if (p && p.rev >= (floor[p.id] ?? 0) && p.rev > (newest.get(p.id)?.rev ?? 0)) newest.set(p.id, p);
      const byName = new Map<string, Held>();
      for (const p of newest.values()) if (p.at > (byName.get(p.name)?.at ?? 0)) byName.set(p.name, p);
      const fresh = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.note(fresh);
      return fresh;
    });
  }

  private note(seen: readonly SecretPlain[]): void {
    this.ch.guardWith(seen);
    const revs = keepSeen(this.ch.access, { seenSecrets: Object.fromEntries(seen.map((p) => [p.id, p.rev])) }).seenSecrets;
    const was = this.ch.access.seenSecrets ?? {};
    if (!revs || Object.entries(revs).every(([id, rev]) => was[id] === rev)) return;
    this.ch.access = { ...this.ch.access, seenSecrets: revs };
    this.ch.onAccess?.(this.ch.access);
  }
}

function older<E>(err: E): E | Rejected {
  return err instanceof RelayError && err.status === 404 && err.tag === "NotFound" ? new Rejected(NO_SECRETS) : err;
}
