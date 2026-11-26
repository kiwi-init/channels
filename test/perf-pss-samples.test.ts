import { describe, expect, test } from "bun:test";
import { changes, sampleOf, settings, stats, webDrops, type ProcRead } from "../scripts/perf-pss-samples.ts";

const T0 = "2026-11-26T10:00:00.000Z";
const web = (pid: number, mib: number | null, started = T0): ProcRead => ({ pid, started, kb: mib === null ? null : mib * 1024 });
const at = (i: number) => new Date(Date.parse("2026-11-26T12:00:00Z") + i * 30_000).toISOString();
const BASE = { tasks: 600, messages: 4000, taskNotes: 7 };

describe("webDrops", () => {
  test("a drop in the same web process counts", () => {
    const samples = [sampleOf(at(0), "live", { web: [web(101, 3200)] }), sampleOf(at(1), "live", { web: [web(101, 800)] })];
    expect(webDrops(samples)).toEqual([{ at: at(1), from: 3200, to: 800 }]);
  });

  test("a replaced web process is a restart, not a drop", () => {
    const samples = [sampleOf(at(0), "live", { web: [web(101, 3200)] }), sampleOf(at(1), "live", { web: [web(202, 800)] })];
    expect(webDrops(samples)).toEqual([]);
    expect(changes(samples[0]!, samples[1]!)).toEqual([`${at(1)} web: [101@${T0}] became [202@${T0}]`]);
  });

  test("a reused PID with a new start time is a restart, not a drop", () => {
    const later = "2026-11-26T12:00:20.000Z";
    const samples = [sampleOf(at(0), "live", { web: [web(101, 3200)] }), sampleOf(at(1), "live", { web: [web(101, 800, later)] })];
    expect(webDrops(samples)).toEqual([]);
    expect(changes(samples[0]!, samples[1]!)).toHaveLength(1);
  });

  test("a failed read is no drop, on either side of it", () => {
    const samples = [sampleOf(at(0), "live", { web: [web(101, 3200)] }), sampleOf(at(1), "live", { web: [web(101, null)] }), sampleOf(at(2), "live", { web: [web(101, 800)] })];
    expect(webDrops(samples)).toEqual([]);
  });
});

describe("sampleOf", () => {
  test("a failed read makes the sample invalid, with no zero in its group", () => {
    const s = sampleOf(at(0), "idle", { web: [web(101, 900)], daemon: [web(7, null)] });
    expect(s.valid).toBe(false);
    expect(s.pss.daemon).toBeNull();
    expect(s.pss.web).toBe(900);
    expect(s.problems).toEqual(["daemon 7: smaps_rollup could not be read"]);
  });

  test("a sample with no web process is invalid", () => {
    const s = sampleOf(at(0), "live", { shell: [web(5, 200)] });
    expect(s.valid).toBe(false);
    expect(s.pss.web).toBeNull();
    expect(s.problems).toEqual(["web: no WebKitWebProcess"]);
  });

  test("a group with no process is 0 MiB, and the sample stays valid", () => {
    const s = sampleOf(at(0), "live", { web: [web(101, 900)] });
    expect(s.valid).toBe(true);
    expect(s.pss.daemon).toBe(0);
  });
});

test("stats is null with no sample, so no minimum comes from a missing one", () => {
  expect(stats([])).toBeNull();
  expect(stats([3, 1, 2, 4])).toEqual({ min: 1, median: 3, max: 4 });
});

describe("settings", () => {
  test("the defaults give 80 live and 100 samples in all", () => {
    const s = settings({}, BASE);
    expect([s.agents, s.everySec, s.messageSec, s.liveSamples, s.totalSamples]).toEqual([10, 30, 6, 80, 100]);
  });

  test.each([
    ["PSS_EVERY_SEC", "0"],
    ["PSS_EVERY_SEC", "-1"],
    ["PSS_MESSAGE_SEC", "0"],
    ["PERF_AGENTS", "0"],
    ["PERF_AGENTS", "2.5"],
    ["PERF_TASKS", "1.5"],
    ["PSS_LIVE_MIN", "x"],
  ])("%s=%s is refused", (name, value) => {
    expect(() => settings({ [name]: value }, BASE)).toThrow(name);
  });

  test("phases that give fewer than 2 samples are refused", () => {
    expect(() => settings({ PSS_LIVE_MIN: "0", PSS_IDLE_MIN: "0" }, BASE)).toThrow("at least 2");
  });

  test("0 stays allowed for the warm-up, one phase and the seed counts", () => {
    const s = settings({ PSS_WARM_MIN: "0", PSS_IDLE_MIN: "0", PERF_TASKS: "0", PERF_MESSAGES: "0", PERF_TASK_NOTES: "0" }, BASE);
    expect([s.warmMin, s.idleMin, s.totalSamples, s.seed.tasks]).toEqual([0, 0, 80, 0]);
  });
});
