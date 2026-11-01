import { ChannelGone, type RoomsSetting } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { ChannelIcon, Message } from "@kiwi/core/protocol.ts";
import { fold, MAIN, placeFromKey, taskId, type ChannelState, type FoldBase, type GuardFloor, type Task } from "@kiwi/core/state.ts";

import type { ChannelIdentityView, FollowEvent, WireError } from "../../desktop/src/bridge.ts";
import type { Keyring } from "../../desktop/src/keyring.ts";
import { usableBase } from "@kiwi/channel/base-plan.ts";
import { foldRoster } from "@kiwi/channel/fold-roster.ts";
import { hear, onlineByName, type Online } from "@kiwi/channel/online.ts";
import { trimmed } from "@kiwi/channel/trim.ts";
import { approveTask, closedDigest, sendBackTask, type TaskSend } from "@kiwi/channel/task-actions.ts";
import { TEND_SAFETY_MS, tendOwned } from "@kiwi/app/approval-tend.ts";
import { followedLaunches, followLaunch, sawMembers, sawRequests, type LaunchSeen } from "@kiwi/app/launch-follow.ts";
import { roomView } from "./view.ts";
import type { Connection, Picture, RoomView } from "./wire.ts";

const WINDOW = 400;
const KEEP = 1_500;
const EMIT_MS = 60;
const RETRY_FIRST_MS = 500;
const RETRY_MOST_MS = 30_000;

const merged = (prev: readonly Message[], more: readonly Message[]): Message[] => {
  const seen = new Set(prev.map((p) => p.seq));
  return [...prev, ...more.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
};

const errorText = (e: WireError): string => (e.kind === "gone" ? `the channel was ${e.why}` : e.message);

interface RoomHooks {
  emit: (room: RoomView) => void;
  lost: (code: string) => void;
  launch: (launch: string, seen: LaunchSeen) => void;
  person: () => string | null;
  log: (line: string) => void;
  devices: (links: unknown) => void;
}

export class Room {
  private messages: Message[] = [];
  private roster: Member[] = [];
  private base: FoldBase | null = null;
  private guard: GuardFloor | null = null;
  private rooms: RoomsSetting | null = null;
  private heard: ReadonlyMap<string, Online> = new Map();
  private connection: Connection = "connecting";
  private gone: "removed" | "closed" | null = null;
  private error: string | null = null;
  private head = 0;
  private since = 0;
  private title: string;
  private icon: ChannelIcon | null = null;
  private stopLive: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryMs = RETRY_FIRST_MS;
  private closed = false;
  private state: ChannelState | null = null;
  private place = "main";
  private tending: Promise<void> | null = null;
  private tendAgain = false;
  private tendedAt = 0;
  private readonly told = new Set<string>();
  private readonly following = new Map<string, () => void>();

  constructor(
    private readonly keyring: Keyring,
    private readonly seat: ChannelIdentityView,
    private readonly hooks: RoomHooks,
  ) {
    this.title = seat.name ?? seat.label;
  }

  get code(): string {
    return this.seat.code ?? "";
  }

  private get me(): string {
    return this.seat.idName ?? this.seat.label;
  }

  private get isOwner(): boolean {
    const access = this.seat.access as { ownerPk?: unknown } | undefined;
    return access?.ownerPk === this.seat.pk;
  }

  async start(): Promise<void> {
    this.schedule();
    this.clock = setInterval(() => {
      this.schedule();
      if (Date.now() - this.tendedAt >= TEND_SAFETY_MS) this.kick();
    }, 30_000);
    await this.connect();
  }

  nudge(): void {
    if (!this.retry) return;
    clearTimeout(this.retry);
    this.retry = null;
    this.retryMs = RETRY_FIRST_MS;
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.refreshRoster();
      const head = await this.keyring.call(this.code, "head");
      this.head = head;
      this.since = Math.max(0, head - WINDOW);
      if (this.since > 0) this.base = usableBase(await this.keyring.call(this.code, "snapshot").catch(() => null), this.since);
      void this.refreshInfo();
      if (this.closed) return;
      this.stopLive = this.keyring.follow(this.code, this.since, (ev) => this.on(ev));
      this.error = null;
      this.schedule();
    } catch (e) {
      this.schedule();
      if (e instanceof ChannelGone) {
        this.gone = e.why;
        return;
      }
      this.error = e instanceof Error ? e.message : String(e);
      this.connection = "reconnecting";
      if (this.closed) return;
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.connect();
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MOST_MS);
    }
  }

  follow(launch: string): void {
    this.following.get(launch)?.();
    let last: LaunchSeen["stage"] | null = null;
    const stop = followLaunch(this.code, launch, (seen) => {
      if (seen.stage === last) return;
      last = seen.stage;
      this.hooks.launch(launch, seen);
      if (seen.stage === "joined") this.unfollow(launch);
    });
    this.following.set(launch, stop);
    this.kick();
  }

  unfollow(launch: string): void {
    this.following.get(launch)?.();
    this.following.delete(launch);
  }

  stop(): void {
    for (const stop of this.following.values()) stop();
    this.following.clear();
    this.closed = true;
    this.stopLive?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.clock) clearInterval(this.clock);
    if (this.retry) clearTimeout(this.retry);
  }

  open(place: string): void {
    this.place = placeFromKey(place) ? place : "main";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush();
  }

  async send(body: string, re: number | null, imgs: readonly Picture[], at: string | null): Promise<number> {
    const names = this.roster.filter((m) => m.active && !m.unverified).map((m) => m.name);
    const named = [...body.matchAll(/(^|\s)@([A-Za-z0-9_.-]+)/g)].map((x) => x[2]!).filter((n) => names.includes(n) && n !== this.me);
    const replyTo = re === null ? undefined : this.messages.find((m) => m.seq === re);
    const where = placeFromKey(at ?? this.place) ?? MAIN;
    if (where.kind === "dm") {
      if (!where.with.includes(this.me)) throw new Error("this conversation is between two others: you can read along");
      const other = where.with[0] === this.me ? where.with[1] : where.with[0];
      return this.keyring.call(this.code, "send", body, { kind: "msg", to: [other], dm: true, ...(re !== null ? { re: [re] } : {}), ...(imgs.length ? { imgs: [...imgs] } : {}) });
    }
    const to = named.length ? named : replyTo && replyTo.from !== this.me ? [replyTo.from] : undefined;
    return this.keyring.call(this.code, "send", body, {
      kind: "msg",
      ...(to ? { to } : {}),
      ...(where.kind === "task" ? { task: where.task } : {}),
      ...(re !== null ? { re: [re] } : {}),
      ...(imgs.length ? { imgs: [...imgs] } : {}),
    });
  }

  async react(seq: number, emoji: string | null): Promise<number> {
    const body = emoji ? `reacted ${emoji} to #${seq}` : `took back the reaction on #${seq}`;
    return this.keyring.call(this.code, "send", body, { kind: "event", ev: { op: "react", seq, emoji } });
  }

  async image(seq: number, index: number): Promise<string | null> {
    const img = this.messages.find((m) => m.seq === seq)?.imgs?.[index];
    return img ? this.keyring.call(this.code, "image", img) : null;
  }

  async answer(seq: number, text: string): Promise<number> {
    const ask = this.messages.find((m) => m.seq === seq);
    if (!ask) throw new Error("that question isn't here any more");
    return this.keyring.call(this.code, "send", text, { to: [ask.from], re: [ask.seq], kind: "msg" });
  }

  async approve(id: number): Promise<number> {
    const state = this.state;
    const task = this.reviewing(id);
    if (!state) throw new Error("this channel hasn't loaded yet");
    const seq = await this.post(approveTask(task));
    await this.post(closedDigest(state, this.messages, task, { by: this.me }));
    return seq;
  }

  async sendBack(id: number, why: string): Promise<number> {
    return this.post(sendBackTask(this.reviewing(id), why));
  }

  private reviewing(id: number): Task {
    const task = this.state?.tasks.get(id);
    if (!task || task.state !== "review") throw new Error(`${taskId(id)} isn't waiting for a review any more`);
    return task;
  }

  private post({ body, opts }: TaskSend): Promise<number> {
    return this.keyring.call(this.code, "send", body, opts);
  }

  private async refreshRoster(): Promise<void> {
    try {
      this.roster = await this.keyring.call(this.code, "members");
      this.schedule();
    } catch (e) {
      this.fail(e);
    }
  }

  private async refreshInfo(): Promise<void> {
    const [title, guard, rooms, icon] = await Promise.all([
      this.keyring.call(this.code, "title").catch(() => null),
      this.keyring.call(this.code, "guard").catch(() => null),
      this.keyring.call(this.code, "rooms").catch(() => null),
      this.keyring.call(this.code, "icon").catch(() => null),
    ]);
    if (title) this.title = title;
    this.icon = icon;
    this.guard = guard;
    this.rooms = rooms;
    this.schedule();
  }

  private kick(): void {
    if (!this.isOwner || this.closed) return;
    if (this.tending) {
      this.tendAgain = true;
      return;
    }
    this.tendedAt = Date.now();
    this.tending = this.tend()
      .catch(() => {})
      .finally(() => {
        this.tending = null;
        if (!this.tendAgain) return;
        this.tendAgain = false;
        this.kick();
      });
  }

  private async tend(): Promise<void> {
    const person = this.hooks.person();
    if (!person) return;
    if (followedLaunches(this.code).length) sawRequests(this.code, await this.keyring.call(this.code, "requests", { person }).catch(() => []));
    const api = {
      autoApprove: async (p: string) => {
        const members = await this.keyring.call(this.code, "autoApprove", p, []);
        sawMembers(this.code, members);
        return members;
      },
      requests: (o: { person: string }) => this.keyring.call(this.code, "requests", o),
    };
    await tendOwned(person, this.title, api, (title, body) => this.hooks.log(`${title}: ${body}`), this.told);
  }

  private fail(e: unknown): void {
    if (e instanceof ChannelGone) {
      this.gone = e.why;
      this.hooks.lost(this.code);
    } else this.error = e instanceof Error ? e.message : String(e);
    this.schedule();
  }

  private on(ev: FollowEvent): void {
    switch (ev._tag) {
      case "Open":
        this.connection = "live";
        this.error = null;
        if (ev.kind !== "page") void this.refreshRoster();
        void this.keyring.presence(this.code, { client: "probe", query: true }).catch(() => {});
        this.kick();
        break;
      case "Request":
        this.kick();
        return;
      case "Message":
        if (ev.message.sigOk && ev.message.kind === "event" && ev.message.ev?.op === "devices") this.hooks.devices(ev.message.ev.links);
        this.messages = merged(this.messages, [ev.message]);
        this.head = Math.max(this.head, ev.message.seq);
        break;
      case "Head":
        this.head = Math.max(this.head, ev.seq);
        break;
      case "Presence":
        this.heard = hear(this.heard, ev.presence, Date.now());
        break;
      case "Roster":
        void this.refreshRoster();
        this.kick();
        break;
      case "Info":
        void this.refreshInfo();
        break;
      case "Down":
        this.connection = "reconnecting";
        break;
      case "Failed":
        if (ev.error.kind === "gone") {
          this.gone = ev.error.why;
          this.hooks.lost(this.code);
        } else {
          this.connection = "reconnecting";
          this.error = errorText(ev.error);
        }
        break;
      default:
        return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, EMIT_MS);
  }

  private flush(): void {
    const now = Date.now();
    const admitted = this.roster.filter((m) => !m.unverified);
    const roster = foldRoster(admitted);
    const next = trimmed(this.messages, roster, now, this.rooms, this.guard, this.base, KEEP);
    if (next) {
      this.base = next;
      this.messages = this.messages.filter((m) => m.seq > next.n);
    }
    this.state = fold(this.messages, roster, now, this.rooms, this.guard, this.base);
    const keyOf = new Map(admitted.filter((m) => m.active).map((m) => [m.name, m.pk]));
    this.hooks.emit(
      roomView({
        code: this.code,
        title: this.title,
        icon: this.icon,
        me: this.me,
        isOwner: this.isOwner,
        connection: this.connection,
        gone: this.gone,
        error: this.error,
        head: this.head,
        whole: this.since === 0,
        messages: this.messages,
        state: this.state,
        online: onlineByName(this.heard, keyOf, now),
        place: this.place,
      }),
    );
  }
}
