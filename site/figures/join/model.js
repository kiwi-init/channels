import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
export const HEIGHT = 432;
export const CODE = "482913";
export const ROOM = "acme";

export const T = { x: 0, y: 236 };
export const R = { x: 20, y: 0 };
export const L = { x: 246, y: -35 };

export const MON = { x0: T.x - 6, x1: T.x + 6, y0: T.y - 80, y1: T.y + 80, z0: 34, z1: 140 };
export const GLASS = { y0: MON.y0 + 7, y1: MON.y1 - 7, z0: MON.z0 + 13, z1: MON.z1 - 7 };
export const BOX = { x: R.x - 45, y: R.y - 35, w: 90, d: 70, r: 4 };
export const BOX_Z = [3, 63];
export const BASE = { x: L.x - 70, y: L.y - 48, w: 140, d: 96, r: 7 };
export const BASE_Z = [1.6, 10];
export const TILT = (13 * Math.PI) / 180;
export const HINGE = [L.x, BASE.y + 6, BASE_Z[1] + 2.2];
export const LID_UP = [0, -Math.sin(TILT), Math.cos(TILT)];
export const LID_OUT = [0, Math.cos(TILT), Math.sin(TILT)];
export const LID = { u0: -70, u1: 70, v0: 1.4, v1: 92, r: 5, t: 4 };
export const DISPLAY = { u0: -64, u1: 64, v0: 9, v1: 87 };

export const CABLE_R = 1.7;
export const PORT_A = { x: T.x, y: BOX.y + BOX.d, z: 17 };
export const PORT_M = { x: T.x, y: MON.y0, z: 46 };
export const PORT_B = { x: BOX.x + BOX.w, y: L.y + 20, z: 17 };
export const PORT_L = { x: BASE.x, y: L.y + 20, z: 6 };

const corner = (route, radius) => G.fillet(route, radius, 9);

export const ROUTE_A = corner(
  [
    [PORT_M.x, PORT_M.y - 14, PORT_M.z],
    [PORT_M.x, PORT_M.y - 28, PORT_M.z],
    [PORT_M.x, PORT_M.y - 30, CABLE_R],
    [PORT_A.x, PORT_A.y + 30, CABLE_R],
    [PORT_A.x, PORT_A.y + 26, PORT_A.z],
    [PORT_A.x, PORT_A.y + 14, PORT_A.z],
  ],
  9,
);

export const ROUTE_B = corner(
  [
    [PORT_B.x + 14, PORT_B.y, PORT_B.z],
    [PORT_B.x + 22, PORT_B.y, PORT_B.z],
    [PORT_B.x + 26, PORT_B.y, CABLE_R],
    [PORT_L.x - 26, PORT_L.y, CABLE_R],
    [PORT_L.x - 20, PORT_L.y, PORT_L.z],
    [PORT_L.x - 12, PORT_L.y, PORT_L.z],
  ],
  8,
);

const EXTENT = [
  ...k.boxCorners({ x: MON.x0, y: MON.y0, w: MON.x1 - MON.x0, d: MON.y1 - MON.y0 }, 0, MON.z1),
  ...k.boxCorners({ x: T.x + 22, y: T.y - 66, w: 52, d: 132 }, 0, 6),
  ...k.boxCorners(BOX, 0, BOX_Z[1]),
  ...k.boxCorners(BASE, 0, BASE_Z[1]),
  [L.x - 70, HINGE[1] - LID.v1 * Math.sin(TILT), HINGE[2] + LID.v1 * Math.cos(TILT)],
  [L.x + 70, HINGE[1] - LID.v1 * Math.sin(TILT), HINGE[2] + LID.v1 * Math.cos(TILT)],
];

export const P = k.fitProjection(EXTENT, WIDTH, HEIGHT, { pad: 34 });

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

export const REEL = { term: { x: 7, y: 66, size: 30, pitch: 18, gap: 18 }, app: { x: 45, y: 49.5, size: 15.5, pitch: 9.3, gap: 9.3 } };

export const LIFT = 2.3;
export const routeScreen = (route) => route.map(([x, y, z]) => k.iso([x, y, z + CABLE_R + LIFT], P));

export const TOUR = {
  ask: [0.6, 2.6],
  card: 2.5,
  roll: [3.0, 4.6],
  cursor: [5.0, 6.1],
  press: 6.25,
  keys: [6.9, 9.0],
  joined: 9.0,
  end: 13.5,
};
