import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
const PAD = 22;

export const CONV = { x0: -300, x1: 22, yFar: 0, yNear: 50, wall: 3.4, zLow: 13, zTop: 27, axle: 21, roller: 3.8, pitch: 10.5 };
export const BOX = { w: 42, d: 30, h: 25, y: 10, z: CONV.axle + CONV.roller };

const GX = -52;
export const ARM = { x: GX, t: 6, h: 7, pivot: [GX, 96, BOX.z + 12], reach: 128 };
export const CAB = { x: GX + 9, y: 80, w: 26, d: 32, r: 2.2, z: 3, top: 47 };
export const HUB = { x0: GX + ARM.t / 2, x1: CAB.x, r: 5 };
export const REST = { x: GX - 5, y: -30, w: 10, d: 10, top: ARM.pivot[2] - ARM.h / 2 };

const STOP = GX - ARM.t / 2 - 16;
export const TRAVEL = { from: -300, wait: STOP - BOX.w, into: CONV.x1 + 3 };

export const MON = { x: -330, y: 66, w: 164, d: 7, z: 52, h: 104 };
export const LAP = { x: 92, y: -96, w: 140, d: 96, h: 7, tilt: 14, lid: 92, lidT: 3.6 };
export const ENDBOX = { x: CONV.x1, y: -10, w: 48, d: 70, r: 2.6, h: 56 };

const tilt = (LAP.tilt * Math.PI) / 180;
export const LID = {
  o: [LAP.x, LAP.y + 5, LAP.h + 0.6],
  n: [0, Math.cos(tilt), Math.sin(tilt)],
  up: [0, -Math.sin(tilt), Math.cos(tilt)],
};

export const PORT_MON = [MON.x + MON.w, MON.y + 3.5, MON.z + 8];
const PORT_LAP = [LAP.x, LAP.y + 44, 3.6];
const GLAND_MON = [CAB.x, CAB.y + 20, 4.6];
export const GLAND_LAP = [CAB.x + CAB.w, CAB.y + 14, 4.6];

function frame() {
  const lidTop = G.add3(LID.o, G.mul3(LID.up, LAP.lid));
  const points = [
    ...k.boxCorners({ x: MON.x, y: MON.y, w: MON.w, d: MON.d }, 0, MON.z + MON.h),
    ...k.boxCorners({ x: LAP.x, y: LAP.y, w: LAP.w, d: LAP.d }, 0, LAP.h),
    [LAP.x, lidTop[1], lidTop[2]],
    [LAP.x + LAP.w, lidTop[1], lidTop[2]],
    [GX, ARM.pivot[1], ARM.pivot[2] + ARM.reach],
    ...k.boxCorners({ x: ENDBOX.x, y: ENDBOX.y, w: ENDBOX.w, d: ENDBOX.d }, 0, ENDBOX.h),
    [CAB.x + CAB.w, CAB.y + CAB.d, 0],
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

function armFrame(angle) {
  const a = [0, -Math.cos(angle), Math.sin(angle)];
  return G.frameOf(ARM.pivot, a, [1, 0, 0], [0, Math.sin(angle), Math.cos(angle)]);
}

const section = (t, h, c) => [
  [-t / 2 + c, -h / 2],
  [t / 2 - c, -h / 2],
  [t / 2, -h / 2 + c],
  [t / 2, h / 2 - c],
  [t / 2 - c, h / 2],
  [-t / 2 + c, h / 2],
  [-t / 2, h / 2 - c],
  [-t / 2, -h / 2 + c],
];

const STRIPES = [16, 36, 56, 76, 96, 116];

export function armPaths(angle) {
  const F = armFrame(angle);
  const boom = G.prismOf(F, section(ARM.t, ARM.h, 0.7), -ARM.h, ARM.reach, P);
  const tip = G.prismOf(F, section(ARM.t + 0.8, ARM.h + 0.8, 0.8), ARM.reach - 3, ARM.reach, P);
  const face = [ARM.t / 2 + 0.02, 0, 0];
  const bands = STRIPES.map((s) => {
    const p = (dz, dx) => at(G.add3(G.add3(G.pointOf(F, s, 0, 0), G.mul3(F.v, dz)), G.mul3([1, 0, 0], dx)));
    return k.pathOf([p(-ARM.h / 2, face[0]), p(ARM.h / 2, face[0]), p(ARM.h / 2, -face[0])]);
  });
  return { boom, tip, bands: bands.join("") };
}

export function boxAt(x) {
  return { x, y: BOX.y, w: BOX.w, d: BOX.d, r: 1.2 };
}

const LANE = (ENDBOX.x + ENDBOX.w + LAP.x) / 2;
const route = (points) => G.fillet(points, 6, 7, { P, tube: 1.1 });
export const MON_ROUTE = route([
  PORT_MON,
  [PORT_MON[0] + 7, PORT_MON[1], PORT_MON[2] - 1],
  [PORT_MON[0] + 9, PORT_MON[1] + 6, 1.1],
  [PORT_MON[0] + 9, GLAND_MON[1], 1.1],
  [GLAND_MON[0] - 10, GLAND_MON[1], 1.1],
  GLAND_MON,
]);
export const LAP_ROUTE = route([PORT_LAP, [LANE, PORT_LAP[1], 1.1], [LANE, GLAND_LAP[1], 1.1], [GLAND_LAP[0] + 12, GLAND_LAP[1], 1.1], [GLAND_LAP[0] + 2.2, GLAND_LAP[1], GLAND_LAP[2]]]);

export const ROLLERS = (() => {
  const out = [];
  for (let x = CONV.x0 + 6; x <= CONV.x1 - 4; x += CONV.pitch) out.push(Math.round(x * 10) / 10);
  return out;
})();
