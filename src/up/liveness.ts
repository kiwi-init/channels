import type { SeatRecord } from "../config.ts";
import type { Liveness } from "../hold.ts";
import { bootTime, pidAlive, processStart } from "../pid.ts";

export interface Probe {
  platform: NodeJS.Platform;
  alive: (pid: number) => boolean;
  start: (pid: number) => string | null;
  boot: () => number | null;
}

const HOST_PROBE: Probe = { platform: process.platform, alive: pidAlive, start: processStart, boot: () => bootTime() };

const ALIVE: Liveness = { kind: "alive" };
const DEAD: Liveness = { kind: "dead" };

export function sessionLiveness(b: SeatRecord, probe: Probe = HOST_PROBE): Liveness {
  if (probe.platform !== "linux" && probe.platform !== "darwin") return { kind: "unknown", why: `kiwi up can't tell whether a session still runs on ${probe.platform}` };
  if (!b.session && !b.pid) return DEAD;
  if (b.pid && b.started) return probe.start(b.pid) === b.started ? ALIVE : DEAD;
  const boot = probe.boot();
  if (boot === null) return { kind: "unknown", why: "this computer didn't say when it started, so a session from before a restart can't be told apart" };
  if ((b.seen ?? b.at ?? 0) < boot) return DEAD;
  if (b.pid) return probe.alive(b.pid) ? ALIVE : DEAD;
  return { kind: "unknown", why: "its session records no process to check" };
}
