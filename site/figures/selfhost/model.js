import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
export const HEIGHT = 470;

export const LAPTOP = { w: 140, d: 96, h: 7, lid: 90, tilt: 12 };
export const CLIENT = { x: -330, y: -30 };
export const DOOR = { x: -146, y: -12, w: 46, d: 36, r: 3, h: 30 };
export const SERVER = { x: -78, y: -40, w: 90, d: 70, r: 4, h: 60 };
export const FRONT = SERVER.y + SERVER.d;
export const CABINET = { x: 40, y: -32, w: 68, d: 60, r: 2.4, h: 116 };
export const FACE = CABINET.y + CABINET.d;
export const SLOT = { x0: CABINET.x + 4, x1: CABINET.x + CABINET.w - 4, h: 18.4, gap: 2.4, top: CABINET.h - 5 };
export const SLOTS = 5;
export const NAMES = ["people", "3926"];
export const IDS = ["c41f", "9d02", "e7a3", "b6f1", "5be8", "a17f"];
export const HALF = 6;
export const REST_T = 4.05;

export const P = k.fitProjection(
  [
    ...k.boxCorners({ x: CLIENT.x, y: CLIENT.y, w: LAPTOP.w, d: LAPTOP.d }, 0, 0),
    [CLIENT.x, CLIENT.y - 18, LAPTOP.lid + 9],
    [CLIENT.x + LAPTOP.w, CLIENT.y - 18, LAPTOP.lid + 9],
    ...k.boxCorners(CABINET, 0, CABINET.h + 2),
    ...k.boxCorners({ x: CABINET.x, y: FACE, w: CABINET.w, d: 40 }, 0, 0),
    ...k.boxCorners(DOOR, 0, DOOR.h),
  ],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 60 },
);

export function slotZ(index) {
  const z1 = SLOT.top - index * (SLOT.h + SLOT.gap);
  return [z1 - SLOT.h, z1];
}

export function planeMatrix(origin, u, v) {
  const o = k.iso(origin, P);
  const a = k.iso([origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]], P);
  const b = k.iso([origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]], P);
  const r = (value) => Math.round(value * 1000) / 1000;
  return `matrix(${r(a[0] - o[0])} ${r(a[1] - o[1])} ${r(b[0] - o[0])} ${r(b[1] - o[1])} ${r(o[0])} ${r(o[1])})`;
}

export function lidFrame(at) {
  const t = (LAPTOP.tilt * Math.PI) / 180;
  return { o: [at.x, at.y + 5, LAPTOP.h + 2.2], a: [0, Math.cos(t), Math.sin(t)], u: [1, 0, 0], v: [0, -Math.sin(t), Math.cos(t)] };
}

export function screenMatrix(at) {
  const F = lidFrame(at);
  const top = [F.o[0] + F.v[0] * LAPTOP.lid, F.o[1] + F.v[1] * LAPTOP.lid, F.o[2] + F.v[2] * LAPTOP.lid];
  return planeMatrix(top, F.u, [-F.v[0], -F.v[1], -F.v[2]]);
}

const PORT_A = [CLIENT.x + LAPTOP.w, CLIENT.y + 64, 4.2];
export const ROUTES = {
  a: G.fillet(
    [
      [PORT_A[0] + 6, PORT_A[1], 4.2],
      [PORT_A[0] + 12, PORT_A[1], 1.5],
      [DOOR.x - 8, PORT_A[1], 1.5],
      [DOOR.x - 8, DOOR.y + 14, 1.5],
      [DOOR.x + 6, DOOR.y + 14, 1.5],
    ],
    6,
    7,
  ),
  b: G.fillet(
    [
      [DOOR.x + DOOR.w + 6, DOOR.y + 18, 9],
      [DOOR.x + DOOR.w + 12, DOOR.y + 18, 1.5],
      [SERVER.x + 8, DOOR.y + 18, 1.5],
    ],
    5,
    7,
  ),
  c: G.fillet(
    [
      [SERVER.x + SERVER.w + 6, SERVER.y + 40, 12],
      [SERVER.x + SERVER.w + 12, SERVER.y + 40, 1.5],
      [CABINET.x + 8, SERVER.y + 40, 1.5],
    ],
    5,
    7,
  ),
};
export const PORT = PORT_A;

const clamp = (value) => Math.min(1, Math.max(0, value));
export const smooth = (a, b, t) => {
  const x = clamp((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

export function along(route, f) {
  const lengths = [0];
  for (let i = 1; i < route.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...route[i].map((v, j) => v - route[i - 1][j])));
  const target = clamp(f) * lengths[lengths.length - 1];
  let i = 1;
  while (i < route.length - 1 && lengths[i] < target) i++;
  const span = lengths[i] - lengths[i - 1] || 1;
  const t = (target - lengths[i - 1]) / span;
  return route[i - 1].map((v, j) => v + (route[i][j] - v) * t);
}

const ARRIVE = [3, 4, 2];
const LEAVE = [4, 2, 3];
const turn = (cycle) => ((cycle % 3) + 3) % 3;

function arrivedAt(slot, cycle) {
  const first = ARRIVE.indexOf(slot);
  return cycle - turn(cycle - first);
}

export function labelOf(slot, cycle) {
  if (slot < NAMES.length) return NAMES[slot];
  return IDS[((arrivedAt(slot, cycle) % IDS.length) + IDS.length) % IDS.length];
}

function drawerAt(slot, cycle, t) {
  const state = { shown: 1, out: 0, lit: 0, drop: 1, card: 0 };
  if (slot === LEAVE[turn(cycle)]) {
    state.out = 34 * smooth(0, 0.8, t);
    state.shown = 1 - smooth(0.35, 0.8, t);
    state.lit = smooth(0, 0.2, t);
  }
  if (slot === ARRIVE[turn(cycle - 1)]) state.lit = 1 - smooth(0, 0.2, t);
  if (slot === ARRIVE[turn(cycle)]) {
    const open = smooth(3.05, 3.5, t) * (1 - smooth(4.3, 4.9, t));
    state.shown = smooth(0.45, 0.8, t);
    state.out = 34 * (1 - smooth(0.45, 1.25, t)) + 16 * open;
    state.lit = Math.max(smooth(0.4, 0.6, t) * (1 - smooth(1.95, 2.05, t)), smooth(2.75, 2.9, t));
    state.drop = 1 - smooth(3.45, 3.95, t);
    state.card = smooth(3.4, 3.55, t) * (1 - smooth(4.25, 4.4, t));
  }
  return state;
}

export function poseAt(time) {
  const cycle = Math.floor(time / HALF);
  const t = time - cycle * HALF;
  const legs = [
    [2.0, 2.3, "a"],
    [2.3, 2.5, "b"],
    [2.5, 2.8, "c"],
  ];
  let bead = null;
  for (const [a, b, leg] of legs) if (t >= a && t < b) bead = { leg, point: along(ROUTES[leg], (t - a) / (b - a)) };
  return {
    cycle,
    t,
    typed: smooth(1.1, 1.9, t),
    bead,
    drawers: Array.from({ length: SLOTS }, (_, slot) => ({ ...drawerAt(slot, cycle, t), label: labelOf(slot, cycle) })),
  };
}

export const REST = poseAt(REST_T);

export function drawerBody(index, out) {
  if (out < 0.2) return "";
  const [z0, z1] = slotZ(index);
  const plan = { x: SLOT.x0 + 2, y: FACE, w: SLOT.x1 - SLOT.x0 - 4, d: out, r: Math.min(1, out / 2) };
  const paths = k.slabOf(plan, z0 + 1.2, z1 - z0 - 4, P, 2);
  const inner = out > 4 ? k.lineSvg(k.planOutline(k.insetPlan(plan, 1.2), z1 - 2.8, P, 2), { tone: "faint" }) : "";
  return k.solidSvg(paths, { tone: "mid", inner });
}
