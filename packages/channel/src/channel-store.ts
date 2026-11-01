import { batch, computed, effect, signal, untracked, type ReadonlySignal, type Signal } from "@preact/signals-core";

import type { CachedRow } from "@kiwi/core/cache-row.ts";
import { ChannelGone } from "@kiwi/core/client/relay-errors.ts";
import type { HumanSession, RoomsSetting, SendOptions } from "@kiwi/core/client.ts";
import type { JoinRequest, Member } from "@kiwi/core/membership.ts";
import { SNAPSHOT_TOO_LARGE, type Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase, type GuardFloor, type Roster } from "@kiwi/core/state.ts";
import { errorOf, linkOf, watches, type ChannelLink, type FollowEvent } from "./channel-ops.ts";
import { backfill, openCached, planCached, readKept, rememberKept, rememberRow, rememberRows } from "./history.ts";
import { markOnce } from "./marks.ts";
import { ICON_LIVE } from "./icon-event.ts";
import { addMarks, type Marks } from "./receipts.ts";
import { noteSignInGone } from "./session.ts";
import { nextSnapshotTry } from "./snapshot-plan.ts";
import { untilOpen } from "./until-open.ts";
import type { Watches } from "./watch.ts";
import { subscribeTick, tickOf } from "./clock.ts";
import { noteAgentWorked } from "./recent.ts";
import { forgetChannel, loadMember, renameChannel, type StoredMember } from "./store.ts";
import { hear, onlineByName, type Online } from "./online.ts";
import { trimmed } from "./trim.ts";
import { foldRoster } from "./fold-roster.ts";
import { asKept, toKept } from "./kept.ts";
import { handOver, onceEach, openChannel, warmUp } from "./open.ts";
import { dropWarm, keepWarm, warmOf, type Warm } from "./warm.ts";

const HISTORY = 2_000;
const KEEP_DELAY_MS = 3_000;
const CLOCK_MS = 15_000;

type Connection = "connecting" | "live" | "reconnecting";

export const APP_BEACON_MS = 60_000;
const ANSWER_GAP_MS = 500;
export interface ChannelHandle {
  ch: ChannelLink;
  connection: Connection;
  gone: "removed" | "closed" | null;
  messages: Message[];
  roster: Member[];
  state: ChannelState;
  online: Map<string, Online>;
  isOwner: boolean;
  requests: JoinRequest[];
  send: (body: string, opts: SendOptions) => Promise<number>;
  refreshRequests: () => Promise<void>;
  refreshRoster: () => Promise<void>;
  head: number;
  marks: Marks;
  pkOf: (name: string) => string | undefined;
  foldFrom: (messages: Message[], base: FoldBase | null) => ChannelState;
  snapshotTooBig: boolean;
  ready: boolean;
}

export interface ChannelStoreDeps {
  link: ChannelLink;
  lend: Watches["lend"];
}

const on = <T>(dep: ReadonlySignal<T>, run: (value: T) => void | (() => void)): (() => void) =>
  effect(() => {
    const value = dep.value;
    return untracked(() => run(value));
  });

const merged = (prev: Message[], more: Message[]) => {
  const seen = new Set(prev.map((p) => p.seq));
  return [...prev, ...more.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
};

export class ChannelStore {
  readonly ch: ChannelLink;
  readonly handle: ReadonlySignal<ChannelHandle>;
  private readonly code: string;
  private readonly human: HumanSession | null | undefined;
  private readonly lend: Watches["lend"];
  private readonly was: Warm | undefined;

  private readonly connection = signal<Connection>("connecting");
  private readonly ready: Signal<boolean>;
  private readonly start = signal<{ head: number; whole: boolean } | null>(null);
  private readonly gone = signal<"removed" | "closed" | null>(null);
  private readonly messages: Signal<Message[]>;
  private readonly unread: Signal<number[]>;
  private readonly roster: Signal<Member[]>;
  private readonly online = signal<ReadonlyMap<string, Online>>(new Map());
  private readonly marks: Signal<Marks>;
  private readonly requests: Signal<JoinRequest[]>;
  private readonly now = signal(tickOf(Date.now(), CLOCK_MS));
  private readonly infoAt = signal(0);
  private readonly guardFloor: Signal<GuardFloor | null>;
  private readonly roomsFloor: Signal<RoomsSetting | null>;
  private readonly base: Signal<FoldBase | null>;
  private readonly snapshotTooBig = signal(false);

  private readonly rosterForFold: ReadonlySignal<Roster>;
  private readonly keyOf: ReadonlySignal<Map<string, string>>;
  private readonly state: ReadonlySignal<ChannelState>;
  private readonly caughtUp: ReadonlySignal<boolean>;
  private readonly head: ReadonlySignal<number>;
  private readonly count: ReadonlySignal<number>;
  private readonly reconcileDue: ReadonlySignal<string>;
  private readonly pruneDue: ReadonlySignal<string>;

  private syncing = false;
  private readonly checksDue: ReadonlySignal<string>;
  private readonly rulesDue: ReadonlySignal<string>;

  private guardIn = false;
  private roomsIn = false;
  private rosterIn = false;
  private snapshotNext = nextSnapshotTry(0, 0);
  private snapshotBusy = false;
  private checksBusy = false;
  private rulesBusy = false;

  constructor(member: StoredMember, human?: HumanSession | null, deps?: ChannelStoreDeps) {
    this.ch = deps?.link ?? linkOf(member);
    this.lend = deps?.lend ?? ((code) => watches().lend(code));
    this.code = member.code;
    this.human = human;
    const was = warmOf(member.code);
    this.was = was;
    this.ready = signal(!!was);
    this.messages = signal(was?.messages ?? []);
    this.unread = signal(was?.unread ?? []);
    this.roster = signal(was?.roster ?? []);
    this.marks = signal(was?.marks ?? new Map());
    this.requests = signal(was?.requests ?? []);
    this.guardFloor = signal(was?.guardFloor ?? null);
    this.roomsFloor = signal(was?.roomsFloor ?? null);
    this.base = signal(was?.base ?? null);

    const admitted = computed(() => this.roster.value.filter((m) => !m.unverified));
    this.keyOf = computed(() => new Map(admitted.value.filter((r) => r.active).map((r) => [r.name, r.pk])));
    this.rosterForFold = computed(() => foldRoster(admitted.value));
    this.state = computed(() => fold(this.messages.value, this.rosterForFold.value, this.now.value, this.roomsFloor.value, this.guardFloor.value, this.base.value));
    this.caughtUp = computed(() => {
      const start = this.start.value;
      return !!start?.whole && (this.messages.value.at(-1)?.seq ?? 0) >= start.head;
    });
    this.head = computed(() => this.state.value.head);
    this.count = computed(() => this.messages.value.length);
    const scopesKey = computed(() => [...this.state.value.members.values()].map((m) => `${m.pk}:${m.scopes.join(",")}`).join("|"));
    const bitsKey = computed(() => this.roster.value.map((m) => `${m.pk}:${m.readOnly ? 0 : 1}`).join("|"));
    const repoList = computed(() => this.state.value.repos.join(","));
    this.reconcileDue = computed(() => `${scopesKey.value}\n${bitsKey.value}\n${this.caughtUp.value}`);
    this.pruneDue = computed(() => `${[...this.keyOf.value.values()].sort().join(",")}\n${this.caughtUp.value}`);
    this.checksDue = computed(() => `${this.head.value}\n${this.caughtUp.value}`);
    this.rulesDue = computed(() => `${this.caughtUp.value}\n${repoList.value}`);
    const pkOf = computed(() => {
      const keys = this.keyOf.value;
      return (name: string) => keys.get(name);
    });
    const foldFrom = computed(() => {
      const roster = this.rosterForFold.value;
      const rooms = this.roomsFloor.value;
      const guard = this.guardFloor.value;
      return (all: Message[], from: FoldBase | null) => fold(all, roster, Date.now(), rooms, guard, from);
    });
    const live = computed(() => onlineByName(this.online.value, this.keyOf.value, this.now.value));
    this.handle = computed(() => ({
      ch: this.ch,
      connection: this.connection.value,
      gone: this.gone.value,
      messages: this.messages.value,
      roster: this.roster.value,
      state: this.state.value,
      online: live.value,
      isOwner: this.ch.isOwner,
      requests: this.requests.value,
      send: this.send,
      refreshRequests: this.refreshRequests,
      refreshRoster: this.refreshRoster,
      head: this.start.value?.head ?? 0,
      marks: this.marks.value,
      pkOf: pkOf.value,
      foldFrom: foldFrom.value,
      snapshotTooBig: this.snapshotTooBig.value,
      ready: this.ready.value,
    }));
  }

  subscribe = (onChange: () => void): (() => void) => {
    let first = true;
    return on(this.handle, () => {
      if (first) first = false;
      else onChange();
    });
  };

  snapshot = (): ChannelHandle => this.handle.value;

  send = (body: string, opts: SendOptions): Promise<number> =>
    this.ch.send(body, opts).catch((err: unknown) => {
      if (this.onGone(err)) throw new Error("you no longer have access to this channel", { cause: err });
      throw err;
    });

  refreshRoster = async (): Promise<void> => {
    try {
      this.roster.value = await this.ch.members();
      this.rosterIn = true;
      if (this.ch.isOwner && (await this.ch.rotateIfDue())) this.roster.value = await this.ch.members();
    } catch (err) {
      this.onGone(err);
    }
  };

  refreshRequests = async (): Promise<void> => {
    if (!this.ch.isOwner) return;
    try {
      this.requests.value = await this.ch.requests();
    } catch (err) {
      this.onGone(err);
    }
  };

  open(): () => void {
    const stops = [
      effect(() => this.keepWarm()),
      effect(() => this.keepSealed()),
      on(this.infoAt, () => this.readInfo()),
      this.follow(),
      on(this.count, () => this.trimSoon()),
      on(this.reconcileDue, () => this.reconcile()),
      on(this.pruneDue, () => this.pruneRooms()),
      () => void import("./prune-plan.ts").then((m) => m.stopPruning(this.ch)),
      on(this.checksDue, () => this.syncSettings()),
      on(this.head, (head) => this.snapshotIfDue(head)),
      on(this.checksDue, () => this.postReviewChecks()),
      this.every(60_000, () => this.drainGithub()),
      on(this.rulesDue, () => this.githubRules()),
      subscribeTick(CLOCK_MS, () => {
        this.now.value = tickOf(Date.now(), CLOCK_MS);
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }

  private onGone(err: unknown): boolean {
    noteSignInGone(err);
    if (!(err instanceof ChannelGone)) return false;
    void forgetChannel(this.code);
    this.gone.value = err.why;
    return true;
  }

  private async loadRoster(): Promise<void> {
    try {
      this.roster.value = await this.ch.members();
      this.rosterIn = true;
    } catch (err) {
      this.onGone(err);
    }
  }

  private keepWarm(): void {
    if (this.gone.value) return dropWarm(this.code);
    keepWarm(this.code, {
      messages: this.messages.value,
      unread: this.unread.value,
      roster: this.roster.value,
      requests: this.requests.value,
      marks: this.marks.value,
      guardFloor: this.guardFloor.value,
      roomsFloor: this.roomsFloor.value,
      base: this.base.value,
    });
  }

  private keepSealed(): (() => void) | undefined {
    if (!this.start.value || this.gone.value) return;
    const kept = toKept({ roster: this.roster.value, base: this.base.value, guardFloor: this.guardFloor.value, roomsFloor: this.roomsFloor.value });
    const t = setTimeout(() => {
      void this.ch
        .keep(kept)
        .then((sealed) => (sealed ? rememberKept(this.ch.roomId, this.ch.pk, sealed) : undefined))
        .catch(() => {});
    }, KEEP_DELAY_MS);
    return () => clearTimeout(t);
  }

  private readInfo(): void {
    void this.ch
      .title()
      .then((name) => {
        const stored = loadMember(this.code);
        if (name && stored && stored.name !== name) void renameChannel(this.code, name);
      })
      .catch(() => {});
    void this.ch.guard().then(
      (g) => {
        this.guardIn = true;
        this.guardFloor.value = g;
      },
      () => {},
    );
    void this.ch.rooms().then(
      (r) => {
        this.roomsIn = true;
        this.roomsFloor.value = r;
      },
      () => {},
    );
  }

  private follow(): () => void {
    if (this.human === null) return () => {};
    const { ch, was } = this;
    const lent = this.lend(this.code);
    let pending: { message: Message; row: CachedRow | null }[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    let stopLive: (() => void) | null = null;
    let closed = false;
    let beat: ReturnType<typeof setInterval> | undefined;
    let answeredAt = 0;
    let filling: "idle" | "running" | "over" = "idle";
    const fill = () => {
      if (filling !== "idle" || closed) return;
      filling = "running";
      void backfill(ch.roomId, ch.pk, {
        older: (before, limit) => ch.olderRows(before, limit),
        hidden: () => typeof document !== "undefined" && document.hidden,
        wait: (ms) => new Promise((done) => setTimeout(done, ms)),
        stopped: () => closed,
      }).then(
        (out) => void (filling = out === "stopped" && !closed ? "idle" : "over"),
        () => void (filling = "over"),
      );
    };
    const here = () => {
      if (closed) return;
      answeredAt = Date.now();
      void ch.presence({ client: "app" }).catch(() => {});
    };
    const enqueue = (message: Message, row: CachedRow | null) => {
      pending.push({ message, row });
      flush ??= setTimeout(() => {
        const batched = pending;
        pending = [];
        flush = undefined;
        this.messages.value = merged(
          this.messages.peek(),
          batched.map((b) => b.message),
        );
        lent.emit({ _tag: "Head", seq: Math.max(...batched.map((b) => b.message.seq)) });
        if (batched.some((b) => b.message.kind === "event" && b.message.ev?.op === "card")) noteAgentWorked();
        void rememberRows(
          ch.roomId,
          ch.pk,
          batched.flatMap((b) => (b.row ? [b.row] : [])),
        ).then(fill, () => {});
      }, 30);
    };
    const onEvent = (ev: FollowEvent) => {
      switch (ev._tag) {
        case "Open":
          markOnce("kiwi:live");
          this.connection.value = "live";
          lent.emit({ _tag: "Open" });
          if (ev.kind !== "page") {
            void this.refreshRequests();
            void this.refreshRoster();
          }
          void ch.presence({ client: "probe", query: true }).catch(() => {});
          here();
          beat ??= setInterval(here, APP_BEACON_MS);
          return;
        case "Message":
          return enqueue(ev.message, ev.row);
        case "Unread":
          this.unread.value = [...this.unread.peek(), ev.seq].slice(-HISTORY);
          if (ev.row) void rememberRow(ch.roomId, ch.pk, ev.row).then(fill, () => {});
          return;
        case "Presence":
          this.online.value = hear(this.online.peek(), ev.presence, Date.now());
          if (ev.presence.query && ev.presence.pk !== ch.pk && Date.now() - answeredAt >= ANSWER_GAP_MS) here();
          return;
        case "Roster":
          void this.refreshRequests();
          return void this.refreshRoster();
        case "Request":
          lent.emit({ _tag: "Request" });
          return void this.refreshRequests();
        case "Read":
          this.marks.value = addMarks(this.marks.peek(), ev.reads, ev.snapshot);
          return;
        case "Info":
          this.infoAt.value = Date.now();
          window.dispatchEvent(new CustomEvent(ICON_LIVE, { detail: this.code }));
          return;
        case "Head":
        case "Status":
          return;
        case "Down":
          this.connection.value = "reconnecting";
          return;
        case "Failed":
          if (!this.onGone(errorOf(ev.error))) this.connection.value = "reconnecting";
          return;
      }
    };
    const early = new Set<number>();
    const earlyUnread = new Set<number>();
    let earlyBase = false;
    let painted = false;
    const steps = onceEach({
      head: () => ch.head(),
      roster: () => this.loadRoster(),
      requests: this.refreshRequests,
      rotate: () => (ch.isOwner ? ch.rotateIfDue().catch((err: unknown) => (this.onGone(err), false)) : Promise.resolve(false)),
      cache: () =>
        openCached(ch.roomId, ch.pk, ch.openRows, HISTORY)
          .then((opened) => (markOnce("kiwi:cache-open"), opened))
          .catch(() => null),
      plan: (opened, head) => planCached(ch.roomId, ch.pk, opened, head, HISTORY).catch(() => null),
      snapshot: () => ch.snapshot().catch(() => null),
      kept: async () => {
        const sealed = await readKept(ch.roomId, ch.pk).catch(() => null);
        markOnce("kiwi:kept-read");
        const kept = sealed ? asKept(await ch.openKept(sealed).catch(() => null)) : null;
        markOnce("kiwi:kept-open");
        return kept;
      },
      early: (cached, kept) => {
        if (closed || painted) return;
        batch(() => {
          if (!this.rosterIn) this.roster.value = kept.roster;
          if (kept.base) {
            earlyBase = true;
            this.base.value = this.base.peek() ?? kept.base;
          }
          if (!this.guardIn) this.guardFloor.value = kept.guardFloor;
          if (!this.roomsIn) this.roomsFloor.value = kept.roomsFloor;
          if (cached?.unread.length) {
            const seen = cached.unread;
            for (const seq of seen) earlyUnread.add(seq);
            this.unread.value = [...new Set([...this.unread.peek(), ...seen])].slice(-HISTORY);
          }
          if (cached?.messages.length) {
            const shown = cached.messages;
            for (const m of shown) early.add(m.seq);
            this.messages.value = merged(this.messages.peek(), shown);
          }
          this.ready.value = true;
        });
      },
      paint: (cached, base) => {
        if (closed) return;
        painted = true;
        batch(() => {
          if (cached?.unread.length || earlyUnread.size) {
            const seen = cached?.unread ?? [];
            this.unread.value = handOver(
              this.unread.peek().map((seq) => ({ seq })),
              earlyUnread,
              seen.map((seq) => ({ seq })),
            )
              .map((u) => u.seq)
              .slice(-HISTORY);
          }
          if (cached?.messages.length || early.size) {
            const kept = cached?.messages ?? [];
            this.messages.value = handOver(this.messages.peek(), early, kept);
            if (kept.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked();
          }
          if (base || earlyBase) this.base.value = base;
          this.ready.value = true;
        });
        fill();
      },
    });
    warmUp(steps, was, HISTORY);
    void untilOpen(
      () => openChannel(steps, was, HISTORY),
      () => {
        this.connection.value = "reconnecting";
      },
      () => closed,
    )
      .then((opened) => {
        if (closed) return;
        this.start.value = { head: opened.head, whole: opened.whole };
        stopLive = ch.follow(opened.since, onEvent);
      })
      .catch((err: unknown) => {
        if (!closed) this.onGone(err);
      });
    return () => {
      closed = true;
      stopLive?.();
      clearTimeout(flush);
      clearInterval(beat);
      lent.release();
    };
  }

  private trimSoon(): () => void {
    const t = setTimeout(() => this.trim(), 0);
    return () => clearTimeout(t);
  }

  private trim(): void {
    const next = trimmed(this.messages.peek(), this.rosterForFold.peek(), this.now.peek(), this.roomsFloor.peek(), this.guardFloor.peek(), this.base.peek(), HISTORY);
    if (!next) return;
    batch(() => {
      this.base.value = next;
      this.messages.value = this.messages.peek().filter((m) => m.seq > next.n);
      this.unread.value = this.unread.peek().filter((seq) => seq > next.n);
    });
  }

  private syncSettings(): void {
    if (!this.ch.isOwner || !this.caughtUp.peek() || !this.guardIn || !this.roomsIn || this.syncing) return;
    this.syncing = true;
    void import("./settings-sync.ts")
      .then((m) => m.syncSettings(this.ch, this.state.peek(), this.guardFloor.peek(), this.roomsFloor.peek()))
      .then(
        (got) =>
          got &&
          batch(() => {
            this.guardFloor.value = got.guard;
            this.roomsFloor.value = got.rooms;
          }),
        () => {},
      )
      .finally(() => (this.syncing = false));
  }

  private pruneRooms(): void {
    if (this.caughtUp.peek() && [...this.state.peek().rooms.values()].some((r) => r.members)) void import("./prune-plan.ts").then((m) => m.prune(this.ch, () => this.state.peek()));
  }

  private reconcile(): void {
    if (!this.ch.isOwner || !this.caughtUp.value || this.roster.value.length === 0) return;
    this.ch.reconcilePosting(this.state.value, this.roster.value).then(
      (changed) => {
        if (changed.length) void this.refreshRoster();
      },
      () => {},
    );
  }

  private snapshotIfDue(head: number): void {
    if (!this.ch.isOwner || this.snapshotBusy || head < this.snapshotNext) return;
    this.snapshotBusy = true;
    this.ch
      .snapshotIfDue()
      .then(async (n) => {
        this.snapshotNext = nextSnapshotTry(head, n ?? (await this.ch.snapshotAt()) ?? 0);
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || !err.message.includes(SNAPSHOT_TOO_LARGE)) return;
        this.snapshotNext = Infinity;
        this.snapshotTooBig.value = true;
      })
      .finally(() => {
        this.snapshotBusy = false;
      });
  }

  private postReviewChecks(): void {
    const state = this.state.value;
    if (!this.ch.isOwner || !this.caughtUp.value || !state.repos.length || this.checksBusy) return;
    this.checksBusy = true;
    const messages = this.messages.value;
    void import("./review-chores.ts")
      .then((m) => m.postReviewChores(this.ch, state, messages))
      .catch(() => {})
      .finally(() => {
        this.checksBusy = false;
      });
  }

  private drainGithub(): void {
    if (this.ch.isOwner && this.state.peek().repos.length) this.ch.drainGithub().catch(() => {});
  }

  private githubRules(): () => void {
    this.syncGithubRules();
    const every = setInterval(() => this.syncGithubRules(), 10 * 60_000);
    return () => clearInterval(every);
  }

  private syncGithubRules(): void {
    const state = this.state.peek();
    if (!this.ch.isOwner || !this.caughtUp.peek() || !state.repos.length || this.rulesBusy) return;
    this.rulesBusy = true;
    this.ch
      .syncGithubRules(state.repos, [...state.github.rules.values()])
      .catch(() => {})
      .then(() => this.ch.syncGithubReleases(state.repos, [...state.github.releases.values()].flat()))
      .catch(() => {})
      .finally(() => {
        this.rulesBusy = false;
      });
  }

  private every(ms: number, run: () => void): () => void {
    run();
    const t = setInterval(run, ms);
    return () => clearInterval(t);
  }
}
