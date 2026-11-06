import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const W = 960;
export const H = 460;

export const LAP = { x: 0, y: 0 };
export const FEET = 1.2;
export const BASE = { w: 96, d: 140, z: FEET, h: 6 };
export const TOP = BASE.z + BASE.h;
export const LID = { w: 140, h: 90, t: 4, tilt: 14, hinge: 6 };
export const DISPLAY = { left: 9, right: 9, top: 7, bottom: 11 };
export const DW = LID.w - DISPLAY.left - DISPLAY.right;
export const DH = LID.h - DISPLAY.top - DISPLAY.bottom;

const RAD = Math.PI / 180;
export const LID_UP = [-Math.sin(LID.tilt * RAD), 0, Math.cos(LID.tilt * RAD)];
export const LID_OUT = [Math.cos(LID.tilt * RAD), 0, Math.sin(LID.tilt * RAD)];
export const LID_O = [LAP.x + LID.hinge, LAP.y + BASE.d / 2, TOP + 5];

export const KEY_PITCH = 118 / 12;
export const KEY_ROWS = [Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), [1.5, 1, 1.2, 4.6, 1.2, 1, 1.5]];
export const SWAP = { row: 1, col: 2 };
export const keyPlan = (row, col) => {
  const widths = KEY_ROWS[row];
  let y = LAP.y + 11;
  for (let i = 0; i < col; i++) y += widths[i] * KEY_PITCH;
  return { x: LAP.x + 12.5 + row * 8.8, y: y + 0.8, w: 7.2, d: widths[col] * KEY_PITCH - 1.6, r: 1 };
};

export const BOX = { x: 8, y: -106, w: 96, d: 74, r: 1.8 };
export const WALL = { t: 2.6, h: 19 };
export const BOX_FLOOR = 1.6;
export const INNER = { x0: BOX.x + WALL.t, x1: BOX.x + BOX.w - WALL.t, y0: BOX.y + WALL.t, y1: BOX.y + BOX.d - WALL.t };
export const MID_Y = (INNER.y0 + INNER.y1) / 2;

export const DIVIDER = { t: 0.9, h: 25 };
export const CLIP = { w: 28, h: 11.5, t: 2.6, below: 2.2 };
export const DIVIDERS = [
  { name: "themes", x: BOX.x + 14, side: 1 },
  { name: "mods", x: BOX.x + 36, side: -1 },
  { name: "layouts", x: BOX.x + 58, side: -1 },
];
export const clipY = (side) => (side > 0 ? INNER.y1 - 1.2 - CLIP.w : INNER.y0 + 1.2);

export const CARD = { w: 36, h: 22, t: 0.8 };
export const CARDS = [
  { name: "studio.json", kind: "theme", slot: DIVIDERS[0].x + 4 },
  { name: "keys.json", kind: "keys", slot: BOX.x + 81 },
  { name: "mirror.json", kind: "layout", slot: DIVIDERS[2].x + 4 },
  { name: "linear", kind: "mod", slot: DIVIDERS[1].x + 4 },
];
export const PILE_ORDER = [3, 2, 1, 0];
export const TRAY_H = 3.4;
export const pileAt = (level) => [BOX.x + BOX.w + 21 + level * 9, MID_Y - 1.6 + 2 * level, TRAY_H + level * CARD.t];
export const TRAY = { x: BOX.x + BOX.w + 6, y: MID_Y - 24, w: 58, d: 48, r: 3.5 };
export const slotAt = (i) => [CARDS[i].slot, MID_Y, BOX_FLOOR + CARD.h / 2];

export function cardFrame(o, theta) {
  return { o, a: [Math.sin(theta), 0, Math.cos(theta)], u: [0, -1, 0], v: [-Math.cos(theta), 0, Math.sin(theta)] };
}

export function cardPaths(o, theta) {
  const plan = k.roundedPlan({ x: -CARD.w / 2, y: -CARD.h / 2, w: CARD.w, d: CARD.h, r: 1.2 }, 4);
  return G.prismOf(cardFrame(o, theta), plan, 0, CARD.t, P);
}

const extremes = [
  ...k.boxCorners({ x: LAP.x - 18, y: LAP.y, w: BASE.w + 18, d: BASE.d, r: 0 }, 0, TOP + 5 + LID.h * Math.cos(LID.tilt * RAD)),
  ...k.boxCorners(BOX, 0, BOX_FLOOR + DIVIDER.h + CLIP.h),
  ...k.boxCorners({ x: BOX.x + BOX.w, y: BOX.y, w: 67, d: BOX.d, r: 0 }, 0, 4),
];

const FIT = k.fitProjection(extremes, W, H, { pad: 30 });
const SCALE = Math.min(FIT.scale, 1.72);
const centre = (() => {
  const unit = { origin: [0, 0], scale: SCALE, azimuth: 45, elevation: 30 };
  const pts = extremes.map((p) => k.iso(p, unit));
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return [W / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, H / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 - 6];
})();

export const P = { origin: centre, scale: SCALE, azimuth: 45, elevation: 30 };

export function planeMatrix(o, U, V) {
  const p0 = k.iso(o, P);
  const pu = k.iso([o[0] + U[0], o[1] + U[1], o[2] + U[2]], P);
  const pv = k.iso([o[0] + V[0], o[1] + V[1], o[2] + V[2]], P);
  const f = (n) => (Math.round(n * 10000) / 10000).toString();
  return `matrix(${f(pu[0] - p0[0])} ${f(pu[1] - p0[1])} ${f(pv[0] - p0[0])} ${f(pv[1] - p0[1])} ${f(p0[0])} ${f(p0[1])})`;
}

export const lidPoint = (u, v, s = 0) => [LID_O[0] + LID_UP[0] * v + LID_OUT[0] * s, LID_O[1] - u, LID_O[2] + LID_UP[2] * v + LID_OUT[2] * s];
export const SCREEN = planeMatrix(lidPoint(-LID.w / 2 + DISPLAY.left, LID.h - DISPLAY.top, 0.05), [0, -1, 0], [-LID_UP[0], 0, -LID_UP[2]]);

export function cardFace(o, theta) {
  const F = cardFrame(o, theta);
  const at = (s, x, y) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  return planeMatrix(at(CARD.t, -CARD.w / 2, CARD.h / 2), F.u, [-F.v[0], -F.v[1], -F.v[2]]);
}

export const AREA = { top: 7, rail: 10, side: 30, panel: 38 };

export function areasOf(mirror, panel) {
  const p = panel ? AREA.panel : 0;
  const chatW = DW - AREA.rail - AREA.side - p;
  if (!mirror) return { rail: 0, side: AREA.rail, chat: AREA.rail + AREA.side, chatW, panel: panel ? DW - AREA.panel : DW };
  return { panel: panel ? 0 : -AREA.panel, chat: p, chatW, side: p + chatW, rail: DW - AREA.rail };
}

export const BUTTON = { u: 4, v: 47, w: 20, h: 7 };
export const CURSOR_REST = [100, 47];

export const STEPS = [
  { card: 0, fly: [0.9, 2.9] },
  { card: 1, fly: [4.6, 6.6] },
  { card: 2, fly: [8.3, 10.3] },
  { card: 3, fly: [12, 14] },
];
export const TOUR = {
  litFor: 1.5,
  cursor: [14.8, 15.9],
  press: 16.15,
  hold: 18.6,
  back: [18.8, 20.05, 21.3, 22.55],
  backFor: 1.2,
  end: 25,
};
