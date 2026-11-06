import * as k from "../../anatomy/iso-kit.js";

export const W = 960;
export const H = 600;
const AZIMUTH = 38;

export const BOARD = { x: 30, y: 30, w: 150, d: 110, r: 5 };
export const BOARD_H = 2.6;
export const SHEET = { x: 38, y: 36, w: 138, d: 98, r: 0.6 };
export const SHEET_Z = 3.3;
export const JAW_Z = 4.6;
export const SLOT = { x: 44.6, y: 65.5, w: 2.8, d: 38, r: 1.4 };
export const STAGES = 5;
export const BOXES = [57, 71];
export const STAGE_STEP = 8.25;
export const STAGE_Y0 = 100.5;

export const PAD = { x: 112, y: 170, w: 52, d: 56, r: 4 };
export const PAD_TOP = 5.6;
export const STAMP_AT = [PAD.x + PAD.w / 2 + 2, PAD.y + PAD.d / 2];
export const DIE_R = 11;

export const CLIP_SHIFT = [112, -136, 0];
export const PAD_SHIFT = [100, -410, 0];
const shifted = (point, by) => [point[0] + by[0], point[1] + by[1]];
const shiftedPlan = (plan, by) => ({ ...plan, x: plan.x + by[0], y: plan.y + by[1] });

export const PRINTS = [
  [SHEET.x + 38, SHEET.y + SHEET.d - 74],
  [SHEET.x + 113, SHEET.y + SHEET.d - 70],
];

export const LAPTOPS = [
  { x: 0, y: -190, harness: "claude" },
  { x: 0, y: -360, harness: "codex" },
];
export const BASE = { w: 96, d: 140, z: 1.2, h: 6 };
export const LID = { w: 140, h: 90, t: 4, tilt: 14, hinge: 6 };
export const DISPLAY = { left: 9, right: 9, top: 7, bottom: 11 };

export const TX = -44;
export const RAIL = { y0: -398, y1: -22, z: 124, h: 10 };
export const POSTS = [-385, -36];
export const TICKET = { w: 30, z0: 90, z1: 126 };
const QUEUE = [-101, -68, -35];
const SEATS = [-120, -290];
const ENTER_Y = -38;

export const sheetAt = (u, v) => [SHEET.x + v, SHEET.y + SHEET.d - u];
export const lidCentre = (laptop) => laptop.y + BASE.d / 2;

const RAD = Math.PI / 180;
export const LID_UP = [-Math.sin(LID.tilt * RAD), 0, Math.cos(LID.tilt * RAD)];
export const LID_OUT = [Math.cos(LID.tilt * RAD), 0, Math.sin(LID.tilt * RAD)];
export const lidOrigin = (laptop) => [laptop.x + LID.hinge, lidCentre(laptop), BASE.z + BASE.h + 5];

const extremes = [
  ...k.boxCorners({ x: TX - 10, y: RAIL.y0 - 4, w: 16, d: RAIL.y1 - RAIL.y0 + 8, r: 0 }, 0, RAIL.z + RAIL.h + 2),
  ...LAPTOPS.flatMap((laptop) => k.boxCorners({ x: laptop.x - 20, y: laptop.y, w: BASE.w + 20, d: BASE.d, r: 0 }, 0, 96)),
  ...k.boxCorners(shiftedPlan(BOARD, CLIP_SHIFT), 0, 18),
  ...k.boxCorners(shiftedPlan(PAD, PAD_SHIFT), 0, 52),
  ...k.boxCorners(shiftedPlan(PAD, PAD_SHIFT), 0, 52 + 36),
];

export const P = k.fitProjection(extremes, W, H, { pad: 22, azimuth: AZIMUTH });

function planeMatrix(origin, ex, ey) {
  const a = k.iso(origin, P);
  const b = k.iso([origin[0] + ex[0], origin[1] + ex[1], origin[2] + ex[2]], P);
  const c = k.iso([origin[0] + ey[0], origin[1] + ey[1], origin[2] + ey[2]], P);
  const f = (value) => Math.round(value * 1000) / 1000;
  return `matrix(${f(b[0] - a[0])} ${f(b[1] - a[1])} ${f(c[0] - a[0])} ${f(c[1] - a[1])} ${f(a[0])} ${f(a[1])})`;
}

export function displayMatrix(laptop) {
  const o = lidOrigin(laptop);
  const top = LID.h - DISPLAY.top;
  const origin = [o[0] + LID_UP[0] * top + LID_OUT[0] * 0.05, o[1] + LID.w / 2 - DISPLAY.left, o[2] + LID_UP[2] * top + LID_OUT[2] * 0.05];
  return planeMatrix(origin, [0, -1, 0], [-LID_UP[0], 0, -LID_UP[2]]);
}

export const DISPLAY_W = LID.w - DISPLAY.left - DISPLAY.right;
export const DISPLAY_H = LID.h - DISPLAY.top - DISPLAY.bottom;

const LOOP = 22;
export const REST = 11.2;
const RESET = 19.6;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const ease = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const span = (t, from, to) => ease((t - from) / (to - from));
const lerp = (a, b, share) => a + (b - a) * share;

const HOPS = [
  { at: 0.6, print: 0 },
  { at: 14.8, print: 1 },
];
const LIFT = 36;
const LAND = 1.55;

function hop(t, start, target) {
  const [hx, hy] = shifted(STAMP_AT, PAD_SHIFT);
  const [px, py] = shifted(target, CLIP_SHIFT);
  const d = t - start;
  if (d <= 0 || d >= 3.6) return [0, 0, 0];
  const rise = span(d, 0, 0.55);
  const go = span(d, 0.35, 1.25);
  const drop = span(d, 1.25, LAND);
  const up = span(d, 1.85, 2.2);
  const back = span(d, 2.05, 3.0);
  const down = span(d, 3.0, 3.45);
  const share = go * (1 - back);
  const height = d < 1.25 ? LIFT * rise : d < 1.85 ? LIFT * (1 - drop) : d < 3.0 ? LIFT * up : LIFT * (1 - down);
  return [(px - hx) * share, (py - hy) * share, height + (SHEET_Z - PAD_TOP) * share];
}

const landing = (index) => HOPS[index].at + LAND;
const ENTER = [3.6, 4.1, 4.6];
const TICK_AT = [9.5, 13.7];

function stageAt(t) {
  const steps = [landing(0) + 0.15, ENTER[0], TICK_AT[1] + 0.5, landing(1) + 0.2];
  const up = steps.reduce((sum, at) => sum + span(t, at, at + 0.7), 0);
  return up * (1 - span(t, RESET, RESET + 1));
}

const LIT_ORDER = [
  ["print", 0, landing(0)],
  ["tick", 0, TICK_AT[0]],
  ["tick", 1, TICK_AT[1]],
  ["print", 1, landing(1)],
];

function litOf(t, kind, index) {
  const order = LIT_ORDER.findIndex(([name, at]) => name === kind && at === index);
  const [, , from] = LIT_ORDER[order];
  const next = LIT_ORDER[order + 1];
  const rise = span(t, from, from + 0.12);
  const fall = next ? span(t, next[2], next[2] + 0.6) : span(t, RESET, RESET + 0.8);
  return rise * (1 - fall);
}

function markAt(t, kind, index, at) {
  const on = span(t, at, at + 0.12) * (1 - span(t, RESET, RESET + 0.8));
  return { on, lit: litOf(t, kind, index) };
}

const TICKETS = [
  { enter: ENTER[0], queue: 0, moves: [[5.6, SEATS[1], 1.3]], done: 11.6 },
  { enter: ENTER[1], queue: 1, moves: [[6.2, SEATS[0], 1.0]], done: 9.2 },
  {
    enter: ENTER[2],
    queue: 2,
    moves: [
      [6.7, QUEUE[0], 0.7],
      [10.0, SEATS[0], 0.8],
    ],
    done: 13.4,
  },
];
const DROP = 20;

function ticketAt(t, ticket) {
  const drop = span(t, ticket.enter, ticket.enter + 0.45);
  const slide = span(t, ticket.enter + 0.35, ticket.enter + 1.15);
  let y = lerp(ENTER_Y, QUEUE[ticket.queue], slide);
  for (const [at, to, time] of ticket.moves) y = lerp(y, to, span(t, at, at + time));
  const pull = span(t, ticket.done, ticket.done + 0.7);
  const on = span(t, ticket.enter, ticket.enter + 0.3) * (1 - pull);
  return { y, z: DROP * (1 - drop) + pull * 16, on };
}

const WORK = [
  [
    { from: 3.0, to: 5.8, task: "spec", done: null },
    { from: 7.1, to: 10.6, task: "T2", done: 9.2 },
    { from: 10.7, to: RESET, task: "T3", done: 13.4 },
  ],
  [{ from: 6.8, to: RESET, task: "T1", done: 11.6 }],
];

function screenAt(t, jobs) {
  const job = jobs.find((entry) => t >= entry.from && t < entry.to);
  if (!job) return { task: "", progress: 0, done: false };
  const end = job.done ?? job.to;
  return { task: job.task, progress: clamp01((t - job.from) / (end - job.from)), done: job.done !== null && t >= job.done };
}

export function poseAt(time) {
  const t = ((time % LOOP) + LOOP) % LOOP;
  const offsets = HOPS.map((entry) => hop(t, entry.at, PRINTS[entry.print]));
  const stamp = offsets.reduce((sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]], [0, 0, 0]);
  return {
    stamp,
    prints: [markAt(t, "print", 0, landing(0)), markAt(t, "print", 1, landing(1))],
    ticks: [markAt(t, "tick", 0, TICK_AT[0]), markAt(t, "tick", 1, TICK_AT[1])],
    stage: stageAt(t),
    tickets: TICKETS.map((ticket) => ticketAt(t, ticket)),
    screens: WORK.map((jobs) => screenAt(t, jobs)),
  };
}

export const stageOffset = (stage) => [0, -stage * STAGE_STEP, 0];

export const OUT_LINES = [40, 47, 54];
const OUT_LENGTHS = [96, 74, 52];

export function outLine(y, i, state) {
  const share = clamp01(state.progress * 3 - i);
  const length = state.task ? OUT_LENGTHS[i] * share : 0;
  return length > 0.5 ? `M6 ${y}H${Math.round((6 + length) * 100) / 100}` : "";
}
