import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
export const HEIGHT = 440;
export const DIGITS = "205618";

export const T = { x: 0, y: 214 };
export const L = { x: 206, y: -30 };

export const MON = { x0: T.x - 6, x1: T.x + 6, y0: T.y - 80, y1: T.y + 80, z0: 34, z1: 140 };
export const GLASS = { y0: MON.y0 + 7, y1: MON.y1 - 7, z0: MON.z0 + 13, z1: MON.z1 - 7 };
export const KB = { x: T.x + 24, y: T.y - 64, w: 48, d: 128, r: 4 };
export const PC = { x: -18, y: 42, w: 68, d: 68, r: 11 };
export const PC_Z = [2.2, 27];
export const SLOT = { x: 15.4, y: 57, w: 3, d: 38, r: 1.4 };
export const LABEL_AT = [27.5, 92];
export const TRAY = { x: 84, y: 46, w: 48, d: 40, r: 3.5 };
export const TRAY_Z = [0, 3.4];
export const STAMP_REST = [156, 74, 0];
export const BASE = { x: L.x - 70, y: L.y - 48, w: 140, d: 96, r: 7 };
export const BASE_Z = [1.6, 10];
export const TILT = (13 * Math.PI) / 180;
export const HINGE = [L.x, BASE.y + 6, BASE_Z[1] + 2.2];
export const LID_UP = [0, -Math.sin(TILT), Math.cos(TILT)];
export const LID_OUT = [0, Math.cos(TILT), Math.sin(TILT)];
export const LID = { u0: -70, u1: 70, v0: 1.4, v1: 92, r: 5, t: 4 };
export const DISPLAY = { u0: -64, u1: 64, v0: 9, v1: 87 };

export const CARD = { w: 34, h: 22, t: 0.9 };
export const CARD_TRAY = [TRAY.x + TRAY.w / 2, TRAY.y + TRAY.d / 2, TRAY_Z[0] + 1.2];
export const CARD_SLOT = [SLOT.x + SLOT.w / 2 - CARD.t / 2, SLOT.y + SLOT.d / 2, PC_Z[1] + CARD.h / 2 - 9];
export const CARD_TOP = PC_Z[1];

const EXTENT = [
  ...k.boxCorners({ x: MON.x0, y: MON.y0, w: MON.x1 - MON.x0, d: MON.y1 - MON.y0 }, 0, MON.z1),
  ...k.boxCorners({ x: KB.x - 2, y: KB.y - 2, w: KB.w + 4, d: KB.d + 4 }, 0, 8),
  ...k.boxCorners(PC, 0, PC_Z[1]),
  ...k.boxCorners(BASE, 0, BASE_Z[1]),
  [STAMP_REST[0] + 10, STAMP_REST[1] + 10, 0],
  [L.x - 70, HINGE[1] - LID.v1 * Math.sin(TILT), HINGE[2] + LID.v1 * Math.cos(TILT)],
  [L.x + 70, HINGE[1] - LID.v1 * Math.sin(TILT), HINGE[2] + LID.v1 * Math.cos(TILT)],
];

const FIT = k.fitProjection(EXTENT, WIDTH, HEIGHT, { pad: 34 });
const SCALE = Math.min(FIT.scale, 1.36);
const centre = (() => {
  const unit = { origin: [0, 0], scale: SCALE, azimuth: 45, elevation: 30 };
  const pts = EXTENT.map((p) => k.iso(p, unit));
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return [WIDTH / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, HEIGHT / 2 - (Math.min(...ys) + Math.max(...ys)) / 2];
})();

export const P = { origin: centre, scale: SCALE, azimuth: 45, elevation: 30 };

export function planeMatrix(o, U, V) {
  const p0 = k.iso(o, P);
  const pu = k.iso([o[0] + U[0], o[1] + U[1], o[2] + U[2]], P);
  const pv = k.iso([o[0] + V[0], o[1] + V[1], o[2] + V[2]], P);
  const f = (n) => (Math.round(n * 10000) / 10000).toString();
  return `matrix(${f(pu[0] - p0[0])} ${f(pu[1] - p0[1])} ${f(pv[0] - p0[0])} ${f(pv[1] - p0[1])} ${f(p0[0])} ${f(p0[1])})`;
}

export const lidPoint = (u, v, s = 0) => [HINGE[0] + u, HINGE[1] + LID_UP[1] * v + LID_OUT[1] * s, HINGE[2] + LID_UP[2] * v + LID_OUT[2] * s];

export const SCREEN_T = planeMatrix([MON.x1, GLASS.y1, GLASS.z1], [0, -1, 0], [0, 0, -1]);
export const SCREEN_L = planeMatrix(lidPoint(DISPLAY.u0, DISPLAY.v1), [1, 0, 0], [0, -LID_UP[1], -LID_UP[2]]);

export const BOXES = { v0: 21, v1: 36, w: 11.5, gap: 2.6, split: 8, u0: 9 };
export const boxU = (i) => BOXES.u0 + i * (BOXES.w + BOXES.gap) + (i >= 3 ? BOXES.split : 0);
export const ROWS = [
  { v: 50, name: "studio" },
  { v: 60, name: "phone" },
  { v: 70, name: "mini" },
];
export const REMOVE_AT = [92, 70.5];
export const CURSOR_REST = [104, 12];

export function cardFrame(o, theta) {
  const a = [Math.sin(theta), 0, Math.cos(theta)];
  const u = [0, -1, 0];
  const v = [-Math.cos(theta), 0, Math.sin(theta)];
  return { o, a, u, v };
}

export function cardPaths(o, theta, vMin = -CARD.h / 2) {
  const F = cardFrame(o, theta);
  const lo = Math.max(-CARD.h / 2, Math.min(CARD.h / 2 - 0.5, vMin));
  const plan = k.roundedPlan({ x: -CARD.w / 2, y: lo, w: CARD.w, d: CARD.h / 2 - lo, r: Math.min(1.6, (CARD.h / 2 - lo) / 2) }, 4);
  return G.prismOf(F, plan, 0, CARD.t, P);
}

export function cardFace(o, theta) {
  const F = cardFrame(o, theta);
  const at = (s, x, y) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  return planeMatrix(at(CARD.t, -CARD.w / 2, CARD.h / 2), F.u, [-F.v[0], -F.v[1], -F.v[2]]);
}

export const TOUR = {
  login: 0.4,
  signed: 1.0,
  digits: 1.5,
  type: [2.2, 0.32],
  listed: 4.3,
  stamp: [4.5, 6.4],
  fly: [6.3, 7.7],
  drop: [7.7, 8.1],
  kept: 8.1,
  cursor: [9.8, 10.8],
  remove: 11.0,
  dark: 11.4,
  pull: [11.7, 12.6],
  end: 14.2,
};
