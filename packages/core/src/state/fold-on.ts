import type { Message } from "../protocol.ts";
import { cursor, type Finishing, type MakeMap } from "./fold.ts";
import type { GithubState } from "./github.ts";
import { summarize } from "./places.ts";
import { same } from "./same.ts";
import { mirrored, TrackedMap, unrecorded } from "./tracked.ts";
import type { ChannelState, ChannelStateDraft, FoldBase, FoldMember, GuardFloor, Roster, RoomsFloor } from "./types.ts";

export interface Folded {
  readonly state: ChannelState;
  readonly misses: readonly string[];
  next(batch: readonly Message[], now: number): ChannelState | null;
}

const tracked: MakeMap = (entries) => new TrackedMap(entries);

const kept = <T>(value: T, was: T | undefined): T => (was !== undefined && same(value, was) ? was : typeof value === "object" && value !== null ? structuredClone(value) : value);

const reused = <T>(value: T, was: T | undefined): T => (was !== undefined && same(value, was) ? was : value);

export function folded(messages: Message[], roster: Roster, now: number, roomsFloor?: RoomsFloor | null, guardFloor?: GuardFloor | null, given?: FoldBase | null, verify = false): Folded {
  const c = cursor(messages, roster, roomsFloor, guardFloor, given, true, tracked);
  const misses: string[] = [];
  let mirror: Record<string, Map<unknown, unknown>> | null = null;
  let last: ChannelStateDraft | null = null;

  const publish = (at: number): ChannelState => {
    const i = c.inner();
    i.at(at);
    const { ctx } = i;
    const openAsks = [...(i.from?.asks ?? []), ...i.stepped].filter(i.stillOpen);
    if (verify && mirror) for (const [name, map] of Object.entries(i.maps)) for (const key of unrecorded(map as TrackedMap<unknown, unknown>, mirror[name]!)) misses.push(`${name}:${String(key)}`);
    const next: Record<string, Map<unknown, unknown>> = {};
    for (const [name, map] of Object.entries(i.maps)) {
      next[name] = mirrored(map as TrackedMap<unknown, unknown>, mirror?.[name] ?? null);
      (map as TrackedMap<unknown, unknown>).rest();
    }
    mirror = next;
    const shownAs = <T>(name: string): T => next[name] as T;
    const v: Finishing = {
      own: false,
      members: new Map([...shownAs<Map<string, FoldMember>>("members")].map(([name, m]) => [name, structuredClone(m)])),
      tasks: shownAs("tasks"),
      facts: shownAs("facts"),
      leases: shownAs("leases"),
      scopesByKey: new Map(i.scopesByKey),
      floors: i.floors.slice(),
      roleFloors: i.roleFloors.slice(),
      lead: i.lead,
      guards: { ...i.guards },
      guarded: { charter: ctx.charter, hold: ctx.hold, repos: ctx.repos },
    };
    const theLead = i.finalize(v, at);
    const github: GithubState = {
      prs: shownAs("prs"),
      checks: shownAs("githubChecks"),
      issues: shownAs("issues"),
      rules: shownAs("rules"),
      releases: shownAs("releases"),
      runs: shownAs("runs"),
      runsSince: ctx.github.runsSince,
      runsForgotten: ctx.github.runsForgotten,
    };
    const was = last;
    const places = summarize(shownAs("placeOf"), v.tasks, shownAs("trust"), i.placesBefore);
    const state: ChannelStateDraft = {
      members: reused(v.members, was?.members),
      tasks: reused(v.tasks, was?.tasks),
      facts: reused(v.facts, was?.facts),
      docs: shownAs("docs"),
      leases: reused(v.leases, was?.leases),
      trust: shownAs("trust"),
      scopeSets: shownAs("scopeSets"),
      roleSets: shownAs("roleSets"),
      gone: shownAs("gone"),
      nicknames: shownAs("nicknames"),
      rejected: shownAs("rejected"),
      openAsks: was && openAsks.length === was.openAsks.length && openAsks.every((m, n) => m === was.openAsks[n]) ? was.openAsks : openAsks,
      askHeads: shownAs("askHeads"),
      specs: shownAs("specs"),
      specsOnly: i.specsOnly,
      duty: i.duty,
      standbys: reused(new Map(i.standbys), was?.standbys),
      homeLead: theLead ?? null,
      checks: shownAs("checks"),
      threadOf: shownAs("threadOf"),
      threadPeople: shownAs("threadPeople"),
      lead: i.dutyLead(theLead ?? null),
      rooms: shownAs("rooms"),
      secret: shownAs("secret"),
      roomOf: shownAs("roomOf"),
      placeOf: shownAs("placeOf"),
      places: was && same(places, was.places) ? was.places : places,
      charter: kept(v.guarded.charter, was?.charter),
      compact: kept(ctx.compact, was?.compact),
      compactProposal: kept(ctx.compactProposal, was?.compactProposal),
      repos: kept(v.guarded.repos, was?.repos),
      github: was && (Object.keys(github) as (keyof GithubState)[]).every((k) => github[k] === was.github[k]) ? was.github : github,
      hold: kept(v.guarded.hold, was?.hold),
      githubWrite: ctx.githubWrite,
      branchPrefix: ctx.branchPrefix,
      quietMs: ctx.quietMs,
      reviewReset: ctx.reviewReset,
      tapToAnswer: ctx.tapToAnswer,
      checkpointDaily: kept(ctx.checkpointDaily, was?.checkpointDaily),
      checkpointAsks: kept(ctx.checkpointAsks, was?.checkpointAsks),
      landing: kept(ctx.landing, was?.landing),
      landingSteps: kept(ctx.landingSteps, was?.landingSteps),
      reactions: shownAs("reactions"),
      edits: shownAs("edits"),
      deleted: shownAs("deleted"),
      head: i.head,
    };
    last = state;
    return state;
  };

  const more = (batch: readonly Message[]): boolean => {
    const i = c.inner();
    let top = i.head;
    for (const m of batch) {
      if (m.seq <= top || i.seen.has(m.seq) || i.forward.has(m.seq)) return false;
      if (m.kind === "event" && (m.ev?.op !== "react" || m.newer !== undefined)) return false;
      if (m.permission || m.perm || m.settled) return false;
      top = m.seq;
    }
    for (const m of batch) {
      i.seen.add(m.seq);
      if ((m.kind === "ask" || m.kind === "blocking") && !m.permission) {
        i.askers.set(m.seq, m.from);
        if (m.esc) i.decisions.add(m.seq);
      }
    }
    for (const m of batch) i.step(m);
    return true;
  };

  let state = publish(now);
  return {
    get state() {
      return state;
    },
    misses,
    next(batch, at) {
      if (batch.length && !more(batch)) return null;
      return (state = publish(at));
    },
  };
}
