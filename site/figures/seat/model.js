import * as k from "../../anatomy/iso-kit.js";

export const W = 960;
export const H = 520;
const AZIMUTH = 45;

export const FOLDER = { x: -16, y: -14, w: 128, d: 168, r: 2 };
export const FOLDER_T = 0.8;
export const FLOOR = FOLDER_T * 2;
export const TAB = { x: 6, y: FOLDER.y + FOLDER.d, w: 40, d: 9, r: 2.5 };

export const LAPTOP = { x: 0, y: 0, harness: "claude" };
export const FEET = 1.2;
export const BASE = { w: 96, d: 140, z: FLOOR + FEET, h: 6 };
export const LID = { w: 140, h: 90, t: 4, tilt: 14, hinge: 6 };
export const DISPLAY = { left: 9, right: 9, top: 7, bottom: 11 };

const RAD = Math.PI / 180;
export const LID_UP = [-Math.sin(LID.tilt * RAD), 0, Math.cos(LID.tilt * RAD)];
export const LID_OUT = [Math.cos(LID.tilt * RAD), 0, Math.sin(LID.tilt * RAD)];
export const lidCentre = (laptop) => laptop.y + BASE.d / 2;
export const lidOrigin = (laptop) => [laptop.x + LID.hinge, lidCentre(laptop), BASE.z + BASE.h + 5];
export const DISPLAY_W = LID.w - DISPLAY.left - DISPLAY.right;
export const DISPLAY_H = LID.h - DISPLAY.top - DISPLAY.bottom;

export const STAND = { x: 128, y: -6, d: 152, feet: 1.2 };
export const WEDGE = [
  [0, 0],
  [30, 0],
  [30, 16],
  [8, 46],
  [0, 46],
];
const SLOPE_A = WEDGE[2];
const SLOPE_B = WEDGE[3];
const SLOPE_LEN = Math.hypot(SLOPE_B[0] - SLOPE_A[0], SLOPE_B[1] - SLOPE_A[1]);
export const SLOPE = {
  length: SLOPE_LEN,
  up: [(SLOPE_B[0] - SLOPE_A[0]) / SLOPE_LEN, 0, (SLOPE_B[1] - SLOPE_A[1]) / SLOPE_LEN],
  out: [(SLOPE_B[1] - SLOPE_A[1]) / SLOPE_LEN, 0, -(SLOPE_B[0] - SLOPE_A[0]) / SLOPE_LEN],
};
export const SLIP = { u0: 9, w: STAND.d - 18, v0: 4.6, h: 25, s: 0.5, t: 0.5 };
export const FACE_X = STAND.x + WEDGE[1][0];
export const PLATE = { y0: STAND.y + 14, y1: STAND.y + STAND.d - 14, z0: STAND.feet + 3, z1: STAND.feet + 13.4 };

export function onSlope(u, v, s = 0) {
  return [STAND.x + SLOPE_A[0] + SLOPE.up[0] * v + SLOPE.out[0] * s, STAND.y + STAND.d - u, STAND.feet + SLOPE_A[1] + SLOPE.up[2] * v + SLOPE.out[2] * s];
}

export const CARD = { x: 64, y: -80, w: 44, h: 50, t: 0.6 };
export const HOLDER = { x: CARD.x + CARD.t / 2, y: CARD.y + CARD.w / 2, r: 10, h: 4.4, top: 20, coil: 2.6 };
export const CARD_Z = HOLDER.top + HOLDER.coil * 0.4;

export const NICKS = ["claude", "atlas"];
export const HANDLE = "@gentle-otter";

const extremes = [
  ...k.boxCorners(FOLDER, 0, 1),
  ...k.boxCorners({ x: -20, y: 0, w: 116, d: 140, r: 0 }, 0, 104),
  ...k.boxCorners({ x: STAND.x, y: STAND.y, w: 34, d: STAND.d, r: 0 }, 0, 52 + SLIP.h),
  ...k.boxCorners({ x: HOLDER.x - HOLDER.r, y: CARD.y, w: HOLDER.r * 2, d: CARD.w, r: 0 }, 0, CARD_Z + CARD.h),
];

export const P = k.fitProjection(extremes, W, H, { pad: 34, azimuth: AZIMUTH });

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

export const slipMatrix = () =>
  planeMatrix(
    onSlope(SLIP.u0, SLIP.v0 + SLIP.h, SLIP.s + SLIP.t + 0.02),
    [0, -1, 0],
    SLOPE.up.map((value) => -value),
  );

const LOOP = 11;
export const REST = 0;
const LIFT = SLIP.h + 12;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const ease = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const span = (t, from, to) => ease((t - from) / (to - from));

const SWAPS = [
  { out: 2.2, back: 8.7, start: 0 },
  { out: 7.7, back: 3.2, start: 1 },
];

function slipAt(t, swap) {
  const share = clamp01(swap.start + span(t, swap.out, swap.out + 1) - span(t, swap.back, swap.back + 1.1));
  return { v: LIFT * share, on: 1 - span(share, 0.5, 1) };
}

const STILLS = [0, 5.5];

export function stillAfter(time) {
  const t = ((time % LOOP) + LOOP) % LOOP;
  return t < STILLS[1] && t >= STILLS[0] ? STILLS[1] : STILLS[0];
}

export function skipAhead(time) {
  const t = ((time % LOOP) + LOOP) % LOOP;
  const base = time - t;
  if (t < SWAPS[0].out) return base + SWAPS[0].out;
  if (t >= SWAPS[1].back + 1.1 && t < SWAPS[1].out) return base + SWAPS[1].out;
  if (t >= SWAPS[0].back + 1.1) return base + LOOP + SWAPS[0].out;
  return time;
}

export function poseAt(time) {
  const t = ((time % LOOP) + LOOP) % LOOP;
  return { slips: SWAPS.map((swap) => slipAt(t, swap)) };
}
