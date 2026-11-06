import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
const PAD = 22;

export const RELAY = { x: -45, y: -35, w: 90, d: 70, r: 3, z: 4, top: 56 };
export const HOUSING = { x: -42, y: -33, w: 84, d: 14, r: 1.6, top: 70 };
export const SLOT = { y: HOUSING.y + HOUSING.d, z: 64, x0: -38, x1: 38 };
export const TRAY = { y: -17, d: 49, w: 41, gap: 2, wall: 1.2, h: 6, floor: 1 };
export const TRAYS = ["ops", "app"].map((name, i) => ({ name, x: -42 + i * (TRAY.w + TRAY.gap) }));
export const APP = TRAYS[1];
export const SLIP = { w: 33, d: 31, t: 0.5 };
export const STACK = [
  [0, 0],
  [1, -1.4],
  [-0.8, 1.2],
];

export const GH = { x: -240, y: -100, w: 46, d: 58, r: 2, z: 3, top: 80 };
export const LAP = { x: 106, y: -150, w: 140, d: 96, h: 7, lid: 90, lidT: 3.6 };
export const OPEN = (104 * Math.PI) / 180;
export const HINGE = [LAP.x, LAP.y + 5, LAP.h + 0.6];

export const PORT_GH = [GH.x + 30, GH.y + GH.d, 10];
export const PORT_IN = [-24, RELAY.y + RELAY.d, 12];
export const PORT_OUT = [RELAY.x + RELAY.w, 8, 12];
export const PORT_LAP = [LAP.x, LAP.y + 46, 3.6];

export function lidAxes(angle) {
  return { n: [0, Math.sin(angle), -Math.cos(angle)], up: [0, Math.cos(angle), Math.sin(angle)] };
}

function frame() {
  const lid = G.add3(HINGE, G.mul3(lidAxes(OPEN).up, LAP.lid));
  const points = [
    ...k.boxCorners({ x: GH.x, y: GH.y, w: GH.w, d: GH.d }, 0, GH.top),
    ...k.boxCorners({ x: RELAY.x, y: RELAY.y, w: RELAY.w, d: RELAY.d }, 0, HOUSING.top),
    ...k.boxCorners({ x: LAP.x, y: LAP.y, w: LAP.w, d: LAP.d }, 0, LAP.h),
    [LAP.x, lid[1], lid[2]],
    [LAP.x + LAP.w, lid[1], lid[2]],
    [PORT_GH[0], PORT_IN[1] + 20, 0],
  ];
  const unit = { origin: [0, 0], scale: 1, azimuth: 45, elevation: 30 };
  const flat = points.map((point) => k.iso(point, unit));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(1.6, (WIDTH - PAD * 2) / (right - left));
  const height = Math.round((bottom - top) * scale + PAD * 2);
  return {
    height,
    P: { origin: [WIDTH / 2 - ((left + right) / 2) * scale, height / 2 - ((top + bottom) / 2) * scale], scale, azimuth: 45, elevation: 30 },
  };
}

const fitted = frame();
export const HEIGHT = fitted.height;
export const P = fitted.P;

export const at = (point) => k.iso(point, P);
const r4 = (value) => Math.round(value * 10000) / 10000;

export function planeMatrix(o, e1, e2) {
  const a = at(o);
  const b = at(G.add3(o, e1));
  const c = at(G.add3(o, e2));
  return `matrix(${r4(b[0] - a[0])} ${r4(b[1] - a[1])} ${r4(c[0] - a[0])} ${r4(c[1] - a[1])} ${r4(a[0])} ${r4(a[1])})`;
}

export function lidPaths(angle) {
  const { n, up } = lidAxes(angle);
  const F = G.frameOf(HINGE, n, [1, 0, 0], up);
  return G.prismOf(F, k.roundedPlan({ x: 0, y: 0, w: LAP.w, d: LAP.lid, r: 5 }, 5), -LAP.lidT, 0, P);
}

export function screenMatrix(angle) {
  const { up } = lidAxes(angle);
  return planeMatrix(G.add3(HINGE, G.mul3(up, LAP.lid)), [1, 0, 0], G.mul3(up, -1));
}

export const FLOOR_Z = RELAY.top + TRAY.floor;

export function slipRest(i) {
  const [dx, dy] = STACK[i];
  return { x: APP.x + (TRAY.w - SLIP.w) / 2 + dx, y: TRAY.y + 9 + dy, z: FLOOR_Z + i * (SLIP.t + 0.15) };
}

export function slipPaths(x, y0, y1, z) {
  return k.slabOf({ x, y: y0, w: SLIP.w, d: Math.max(0.01, y1 - y0), r: 0.4 }, z, SLIP.t, P, 1);
}

export function slipText(x, y, z) {
  return planeMatrix([x, y, z + SLIP.t], [1, 0, 0], [0, 1, 0]);
}

const route = (points) => G.fillet(points, 6, 7, { P, tube: 1.1 });
const LANE_Y = PORT_IN[1] + 18;
export const GH_ROUTE = route([
  PORT_GH,
  [PORT_GH[0], PORT_GH[1] + 7, PORT_GH[2] - 1],
  [PORT_GH[0] + 6, PORT_GH[1] + 9, 1.1],
  [PORT_GH[0] + 6, LANE_Y, 1.1],
  [PORT_IN[0] - 6, LANE_Y, 1.1],
  [PORT_IN[0] - 6, PORT_IN[1] + 9, 1.1],
  [PORT_IN[0], PORT_IN[1] + 7, PORT_IN[2] - 1],
  PORT_IN,
]);
const LANE_X = (RELAY.x + RELAY.w + LAP.x) / 2;
export const LAP_ROUTE = route([
  [PORT_LAP[0] - 2.2, PORT_LAP[1], PORT_LAP[2]],
  [PORT_LAP[0] - 12, PORT_LAP[1], 1.1],
  [LANE_X, PORT_LAP[1], 1.1],
  [LANE_X, PORT_OUT[1] + 6, 1.1],
  [PORT_OUT[0] + 9, PORT_OUT[1] + 6, 1.1],
  [PORT_OUT[0] + 7, PORT_OUT[1], PORT_OUT[2] - 1],
  PORT_OUT,
]);

export const PACKET = { w: 9, d: 7, h: 6 };

export function cipherOf(n) {
  let seed = (n + 1) * 0x9e3779b9;
  const hex = [];
  for (let i = 0; i < 16; i++) {
    seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d);
    seed = Math.imul(seed ^ (seed >>> 12), 0x297a2d39) ^ (seed >>> 15);
    hex.push(((seed >>> 7) & 15).toString(16));
  }
  return [0, 4, 8, 12].map((i) => hex.slice(i, i + 4).join("")).join(" ");
}
