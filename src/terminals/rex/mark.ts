import { allSeats, loadConfig, type SeatRecord } from "../../config.ts";
import { activityEnv } from "../../daemon/reach.ts";
import { harnessActivity } from "../../harness.ts";
import type { StatusRecord } from "../plugin.ts";
import { leadsTerminal } from "../shared/foreground.ts";
import { clearFrame, statusFrame, takesStatus, writeFrames } from "../shared/osc7501.ts";
import { rexForeground, rexRootState } from "./api.ts";

interface ReadyOptions {
  idle?: boolean;
  rexCheck?: boolean;
}

async function readyDevice(record: SeatRecord, opts: ReadyOptions = {}): Promise<string | null> {
  if (!takesStatus(record.term) || !record.pid) return null;
  const device = leadsTerminal(record.pid);
  if (!device) return null;
  if (record.rex) {
    if (opts.rexCheck !== false && rexForeground(record.rex) !== record.pid) return null;
    if (opts.idle !== false) {
      const state = rexRootState(record.rex);
      if (state !== "done" && state !== "idle") return null;
    }
  } else if (opts.idle !== false) {
    const env = activityEnv(record, process.env);
    const activity = env ? await harnessActivity(env) : undefined;
    if (activity?.state !== "idle") return null;
  }
  return device.path;
}

function uniqueRecords(): SeatRecord[] {
  const seen = new Set<string>();
  return allSeats(loadConfig()).filter((record) => {
    const key = `${record.alias}\u0000${record.as}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function clearMarks(): Promise<number> {
  let cleared = 0;
  for (const record of uniqueRecords()) {
    if (!takesStatus(record.term)) continue;
    const device = await readyDevice(record, { idle: false, rexCheck: false });
    if (device && writeFrames(device, clearFrame("kiwi"))) cleared++;
  }
  return cleared;
}

export async function markSeat(record: SeatRecord, records: readonly StatusRecord[], cleared: readonly string[]): Promise<boolean> {
  const device = await readyDevice(record);
  return !!device && writeFrames(device, [...records.map(statusFrame), ...cleared.map(clearFrame)].join(""));
}
