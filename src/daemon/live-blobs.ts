import { signRequest } from "@kiwi/core/auth.ts";
import type { Channel } from "@kiwi/core/client.ts";
import { LIVE_PATH, liveState, sealLive, type LiveState } from "@kiwi/core/live.ts";
import type { Activity } from "@kiwi/core/protocol.ts";
import type { ChannelState, Task } from "@kiwi/core/state/types.ts";

export const LIVE_IDLE_MS = 90_000;
export const LIVE_CHECK_MS = 30_000;
export const LIVE_REFRESH_MS = 10 * 60_000;
export const LIVE_ABSENT_MS = 60 * 60_000;

export type LiveAbout = Omit<Parameters<typeof liveState>[0], "since"> & { since?: number | null };

export interface LiveIo {
  put(state: LiveState): Promise<number>;
  drop(): Promise<number>;
  about(): Promise<LiveAbout | null>;
  now?: () => number;
}

const ok = (status: number): boolean => status >= 200 && status < 300;

export class LiveBlobs {
  private on = false;
  private sig = "";
  private since = 0;
  private putAt = 0;
  private checkedAt = 0;
  private idleAt: number | null = null;
  private absentUntil = 0;
  private busy = false;

  constructor(private readonly io: LiveIo) {}

  private now(): number {
    return (this.io.now ?? Date.now)();
  }

  async tick(activity: Activity | undefined): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step(activity?.state === "working" ? activity : null);
    } finally {
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    if (!this.on) return;
    this.on = false;
    await this.io.drop().catch(() => 0);
  }

  private async step(working: Activity | null): Promise<void> {
    const now = this.now();
    if (now < this.absentUntil) return;
    if (!working) {
      if (!this.on) return;
      this.idleAt ??= now;
      if (now - this.idleAt < LIVE_IDLE_MS) return;
      const status = await this.io.drop();
      if (ok(status) || status === 404) this.reset();
      return;
    }
    this.idleAt = null;
    if (!this.on && this.putAt === 0) this.since = working.since ?? now;
    const stale = now - this.putAt >= LIVE_REFRESH_MS;
    if (this.on && !stale && now - this.checkedAt < LIVE_CHECK_MS) return;
    this.checkedAt = now;
    const about = await this.io.about();
    if (!about) return;
    const state = liveState({ ...about, since: about.since ?? this.since });
    const sig = JSON.stringify({ ...state, s: 0 });
    if (this.on && sig === this.sig && !stale) return;
    const status = await this.io.put(state);
    if (status === 404) {
      this.absentUntil = now + LIVE_ABSENT_MS;
      return;
    }
    if (!ok(status)) return;
    this.on = true;
    this.sig = sig;
    this.putAt = now;
  }

  private reset(): void {
    this.on = false;
    this.sig = "";
    this.putAt = 0;
    this.idleAt = null;
  }
}

export function liveAbout(state: ChannelState, agent: string, title: string): LiveAbout | null {
  const me = state.members.get(agent);
  if (!me) return null;
  const started = (t: Task): number => (t.clock?.key.startsWith(`${agent}|work|`) ? t.clock.at : 0);
  const task = [...state.tasks.values()].filter((t) => t.owner === agent && t.state === "doing" && !t.archived).sort((a, b) => started(b) - started(a) || b.updatedAt - a.updatedAt)[0];
  return {
    name: me.display ?? me.name,
    face: state.lead === agent ? "lead" : (me.persona?.role ?? "default"),
    color: me.color ?? null,
    task: task ? `T${task.id} ${task.title}` : null,
    since: task && started(task) ? started(task) : null,
    title,
  };
}

export function relayLiveIo(ch: Channel, about: () => Promise<LiveAbout | null>, f: typeof fetch = fetch): LiveIo {
  const call = async (method: "PUT" | "DELETE", body?: object): Promise<number> => {
    const roomId = ch.access.roomId;
    const text = body ? JSON.stringify(body) : "";
    const headers: Record<string, string> = { authorization: `Bearer ${await signRequest(ch.identity, roomId, method, LIVE_PATH, text)}` };
    if (text) headers["content-type"] = "application/json";
    const res = await f(new URL(`/v1/rooms/${roomId}${LIVE_PATH}`, ch.relay), { method, headers, ...(text ? { body: text } : {}) });
    await res.body?.cancel().catch(() => {});
    return res.status;
  };
  return {
    about,
    put: async (state) => {
      const key = ch.access.keys[String(ch.access.epoch)];
      if (!key) return 0;
      return call("PUT", await sealLive(key, ch.access.roomId, state)).catch(() => 0);
    },
    drop: () => call("DELETE").catch(() => 0),
  };
}
