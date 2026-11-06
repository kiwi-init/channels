import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
export const SCALE = 1.6;
export const AZIMUTH = 57;

export const DESK = { x: -98, y: -72, w: 350, d: 138, r: 8 };
export const DESK_H = 10;
export const FOOT_H = 6;

export const BASE = { x: -70, y: -40, w: 140, d: 96, r: 6 };
export const BASE_Z = 1.2;
export const BASE_TOP = 8.4;
export const TILT = (14 * Math.PI) / 180;
export const LID = { length: 90, thick: 3.6, hingeY: BASE.y + 2.4, hingeZ: BASE_TOP + 0.6 };
export const UP = [0, -Math.sin(TILT), Math.cos(TILT)];
export const FACE = [0, Math.cos(TILT), Math.sin(TILT)];
export const LID_TOP = [0, LID.hingeY + UP[1] * LID.length, LID.hingeZ + UP[2] * LID.length];
export const GLASS = { x0: -64, x1: 64, v0: 5, v1: 80, r: 2 };
export const BAR_V = 74.5;
export const ROWS_V = [12.5, 18.5, 23.5, 29.5, 35, 40.5, 46, 51.5, 57];

export const PRINTER = { x: 102, y: -54, w: 68, d: 78, r: 6 };
export const PRINTER_Z = 2.2;
export const PRINTER_TOP = 28;
export const PAPER_Y = 4.2;
export const SLOT_Z = PRINTER_TOP;
export const SLIP = { w: 50, x0: PRINTER.x + (PRINTER.w - 50) / 2 };

export const SPIKE = { x: 212, y: 30, r: 24, foot: 1.2, h: 4.4, boss: 7.6, needle: 0.8, tip: 62 };
export const STACK_GAP = 1.15;

export const PROMPT = 30;
export const LINE = 3.8;
export const lengthOf = (task, lines) => PROMPT + LINE * Math.min(lines, task.work.length) + (lines > task.work.length ? 7 : 0);

export const TASKS = [
  {
    head: "TASK T7",
    title: "fix login redirect",
    end: "ends: task done T7",
    nonce: "#7f3a",
    log: "task T7",
    prompt: "> Work on T7: fix the login redirect.",
    how: "  When it's done: kiwi task done T7",
    work: ["● Read src/auth/login.ts", "● Edit src/auth/login.ts", "● Bash(bun test auth)"],
    last: "● Bash(kiwi task done T7)",
    done: "✓ done T7",
  },
  {
    head: "REVIEW T9",
    title: "round 2, retry on sync",
    end: "ends: verdict, round 2",
    nonce: "#c41d",
    log: "review T9 round 2",
    prompt: "> Review T9, round 2: retry on sync.",
    how: "  End with your verdict for round 2",
    work: ["● Bash(git diff main...T9)", "● Read src/sync/retry.ts"],
    last: "● Bash(kiwi task review T9 --ok)",
    done: "✓ verdict r2",
  },
  {
    head: "TASK T12",
    title: "cache the avatar list",
    end: "ends: task done T12",
    nonce: "#09be",
    log: "task T12",
    prompt: "> Work on T12: cache the avatar list.",
    how: "  When it's done: kiwi task done T12",
    work: ["● Read src/ui/avatars.ts", "● Edit src/ui/avatars.ts", "● Edit src/ui/cache.ts", "● Bash(bun test ui)"],
    last: "● Bash(kiwi task done T12)",
    done: "✓ done T12",
  },
  {
    head: "MESSAGES",
    title: "2 for you",
    end: "ends: none unread",
    nonce: "#5a62",
    log: "2 messages",
    prompt: "> 2 messages for you in #api.",
    how: "  Read them: kiwi join",
    work: ["● Bash(kiwi join)"],
    last: "● Bash(kiwi send …)",
    done: "✓ read",
  },
];

export const STACK = [
  { length: 48, angle: 0.5, task: 3 },
  { length: 43, angle: -0.35, task: 1 },
  { length: 56, angle: 0.1, task: 0 },
  { length: 41, angle: 0.85, task: 3 },
  { length: 52, angle: -0.12, task: 2 },
];
export const EXTRAS = 12;
export const landAngle = (index) => [0.42, -0.28, 0.7, -0.05, 0.25, -0.5][index % 6];

const PRINT = 1.2;
const WORK = 0.8;
const IDLE = 1.1;
const FLIGHT = 1.6;
const AFTER = 0.9;

export function scheduleOf(task) {
  const start = 0.4;
  const printed = start + PRINT;
  const lines = task.work.map((_, i) => printed + 0.4 + WORK * i);
  const last = printed + 0.4 + WORK * task.work.length;
  const tear = last + IDLE;
  const land = tear + FLIGHT;
  return { start, printed, lines, last, tear, land, end: land + AFTER };
}

export function slipLength(task, c) {
  const s = scheduleOf(task);
  if (c < s.start) return 0;
  if (c < s.printed) return PROMPT * smooth01((c - s.start) / PRINT);
  let length = PROMPT;
  [...s.lines, s.last].forEach((at, i) => {
    const grow = i < task.work.length ? LINE : 7;
    length += grow * smooth01((c - at) / 0.32);
  });
  return length;
}

export const smooth01 = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const BOUNDS = [
  ...k.boxCorners(DESK, -DESK_H - FOOT_H, 0),
  [BASE.x, LID_TOP[1], LID_TOP[2]],
  [BASE.x + BASE.w, LID_TOP[1], LID_TOP[2]],
  [SLIP.x0, PAPER_Y, SLOT_Z + lengthOf(TASKS[2], 9) + 4],
  [SLIP.x0 + SLIP.w, PAPER_Y, SLOT_Z + lengthOf(TASKS[2], 9) + 4],
];

function centred(points, pad) {
  const unit = { origin: [0, 0], scale: SCALE, azimuth: AZIMUTH, elevation: 30 };
  const flat = points.map((point) => k.iso(point, unit));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const height = Math.ceil(Math.max(...ys) - Math.min(...ys) + pad * 2);
  const origin = [WIDTH / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, height / 2 - (Math.min(...ys) + Math.max(...ys)) / 2];
  return { height, P: { ...unit, origin } };
}

const FIT = centred(BOUNDS, 22);
export const HEIGHT = FIT.height;
export const P = FIT.P;

export const at = (point) => k.iso(point, P);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const fine = (value) => Math.round(value * 1000) / 1000;

export function planeMatrix(o, U, V) {
  const a = at(o);
  const u = at(add(o, U));
  const v = at(add(o, V));
  return `matrix(${fine(u[0] - a[0])} ${fine(u[1] - a[1])} ${fine(v[0] - a[0])} ${fine(v[1] - a[1])} ${fine(a[0])} ${fine(a[1])})`;
}

export const stackZ = (index) => SPIKE.boss + 0.4 + index * STACK_GAP;

function rotX([x, y, z], a) {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

function rotZ([x, y, z], a) {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}

export function printerPose(length) {
  return { o: [SLIP.x0, PAPER_Y, SLOT_Z + length], U: [1, 0, 0], W: [0, 0, -1] };
}

export function spikePose(length, z, angle) {
  const U = [Math.sin(angle), -Math.cos(angle), 0];
  const W = [Math.cos(angle), Math.sin(angle), 0];
  const o = add(add([SPIKE.x, SPIKE.y, z], mul(U, -SLIP.w / 2)), mul(W, -length / 2));
  return { o, U, W };
}

export function flightPose(length, t, z, angle) {
  const lift = smooth01(t / 0.62);
  const drop = smooth01((t - 0.62) / 0.38);
  const tilt = (Math.PI / 2) * smooth01(t / 0.55);
  let turn = angle - Math.PI / 2;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const spin = turn * smooth01((t - 0.1) / 0.5);
  const U = rotZ(rotX([1, 0, 0], tilt), spin);
  const W = rotZ(rotX([0, 0, -1], tilt), spin);
  const start = [SLIP.x0 + SLIP.w / 2, PAPER_Y, SLOT_Z + 2.2 + length / 2];
  const above = [SPIKE.x, SPIKE.y, SPIKE.tip + 9];
  const arc = Math.sin(Math.PI * lift) * 16;
  const travel = [start[0] + (above[0] - start[0]) * lift, start[1] + (above[1] - start[1]) * lift, start[2] + (above[2] - start[2]) * lift + arc];
  const centre = [travel[0], travel[1], travel[2] + (z - above[2]) * drop];
  const o = add(add(centre, mul(U, -SLIP.w / 2)), mul(W, -length / 2));
  return { o, U, W, centre };
}

export const poseMatrix = ({ o, U, W }) => planeMatrix(o, U, W);

export const STILL = { task: 0, c: scheduleOf(TASKS[0]).lines[1] + 0.5 };

export function screenAt(task, c) {
  const s = scheduleOf(task);
  const rows = [{ text: `kiwi loop › ${task.log} · fresh session`, tone: "lo", on: 1 }];
  rows.push({ text: task.prompt, tone: "hi", on: c >= s.start ? 1 : 0 });
  rows.push({ text: task.how, tone: "mid", on: c >= s.start ? 1 : 0 });
  task.work.forEach((text, i) => rows.push({ text, tone: "mid", on: c >= s.lines[i] ? 1 : 0 }));
  rows.push({ text: task.last, tone: "hi", on: c >= s.last ? 1 : 0 });
  return rows;
}

export function needlePaths(z0, z1, tip) {
  if (z1 <= z0 + 0.05) return null;
  const F = G.frameAlong([SPIKE.x, SPIKE.y, z0], [0, 0, 1]);
  const length = z1 - z0;
  const profile = tip
    ? [
        [0, SPIKE.needle],
        [Math.max(0.01, length - 4), SPIKE.needle],
        [length, 0.08],
      ]
    : [
        [0, SPIKE.needle],
        [length, SPIKE.needle],
      ];
  return G.solidOf(profile, F, P, { steps: 24, rims: tip ? "first" : "none" });
}
