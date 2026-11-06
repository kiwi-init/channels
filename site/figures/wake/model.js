import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const WIDTH = 960;
export const SCALE = 1.6;
export const AZIMUTH = 57;

export const DESK = { x: -104, y: -60, w: 340, d: 118, r: 8 };
export const DESK_H = 10;
export const FOOT_H = 6;

export const MON = { x0: -88, x1: 88, back: -26, front: -16, z0: 36, z1: 148 };
export const GLASS = { x0: -82, x1: 82, z0: 54, z1: 142, r: 2, depth: 1.2 };
export const BAR_Z = 61;
export const PANE_W = (GLASS.x1 - GLASS.x0 - 2) / 3;
export const paneX = (i) => GLASS.x0 + i * (PANE_W + 1);

export const KB = { x: -76, y: 6, w: 144, d: 50, r: 3 };

export const STAND = { x: 172, y: 8 };
export const PLANK = { x: 112, y: -13, w: 120, d: 44, r: 2 };
export const PLANK_Z = 48;
export const PLANK_H = 6;
export const BOX_Z = PLANK_Z + PLANK_H + 1.2;
export const BOX = { half: 13, wall: 17, back: -10, front: 28 };
export const BOXES = [132, 172, 212];
export const SLOT_Y = (BOX.back + BOX.front) / 2;
export const ROOF_Z = BOX_Z + BOX.wall;
export const RIDGE_Z = ROOF_Z + BOX.half;

export const FLAG = { y: -3, z: BOX_Z + 10, arm: 30, plate: [19, 30.6], drop: 9.4, x0: 0.5, x1: 1.4 };
export const LETTER = { w: 21, h: 14, top: 142, rest: BOX_Z + 2.4 };

export const AGENTS = [
  { name: "claude", wake: "> New Kiwi messages", read: "● Bash(kiwi join)", done: "● On it.", typed: false },
  { name: "codex", wake: "› New Kiwi messages", read: "• Ran kiwi join", done: "• On it.", typed: false },
  { name: "gemini", wake: "> New Kiwi messages", read: "✓ Shell kiwi join", done: "✦ On it.", typed: true },
];
export const STILL = 1;

const BOUNDS = [...k.boxCorners(DESK, -DESK_H - FOOT_H, 0), [MON.x0, MON.back, MON.z1], [MON.x1, MON.back, MON.z1], ...BOXES.map((x) => [x, SLOT_Y, LETTER.top + LETTER.h])];

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
export const faceMatrix = (y) => k.sideMatrix([0, y], 0, P, "left");

export const roofZ = (dx) => ROOF_Z + Math.sqrt(Math.max(0, BOX.half * BOX.half - dx * dx));

export function flagSolids(index, lift) {
  const angle = (lift * Math.PI) / 2;
  const x = BOXES[index] + BOX.half;
  const u = [0, Math.cos(angle), Math.sin(angle)];
  const v = [0, -Math.sin(angle), Math.cos(angle)];
  const F = G.frameOf([x, FLAG.y, FLAG.z], [1, 0, 0], u, v);
  const arm = G.prismOf(
    F,
    [
      [-1.4, -0.9],
      [FLAG.arm, -0.9],
      [FLAG.arm, 0.9],
      [-1.4, 0.9],
    ],
    FLAG.x0,
    FLAG.x1,
    P,
  );
  const plate = G.prismOf(
    F,
    [
      [FLAG.plate[0], 0.9],
      [FLAG.plate[1], 0.9],
      [FLAG.plate[1], FLAG.drop],
      [FLAG.plate[0], FLAG.drop],
    ],
    FLAG.x0,
    FLAG.x1,
    P,
  );
  return [arm, plate];
}

export const SOLID_KEYS = ["fill", "s0", "s1", "s2", "s3", "top", "crease", "outline"];

export function solidDs(paths) {
  return [paths.fill, ...paths.shades, paths.top, paths.crease, paths.outline];
}

export function liveSolid(paths, { tone = "hi", lit = false, part = "" } = {}) {
  const [fill, s0, s1, s2, s3, top, crease, outline] = solidDs(paths);
  return [
    `<g class="iso-solid"${lit ? ' data-lit=""' : ""}${part ? ` data-part="${part}"` : ""}>`,
    `<path class="iso-fill" d="${fill}"/>`,
    `<path class="iso-shade" data-shade="0" d="${s0}"/>`,
    `<path class="iso-shade" data-shade="1" d="${s1}"/>`,
    `<path class="iso-shade" data-shade="2" d="${s2}"/>`,
    `<path class="iso-shade" data-shade="3" d="${s3}"/>`,
    `<path class="iso-top" d="${top}"/>`,
    `<path class="iso-line iso-crease" data-tone="faint" d="${crease}"/>`,
    `<path class="iso-line iso-edge" data-tone="${tone}" d="${outline}"/>`,
    `</g>`,
  ].join("");
}

export const LINES = { wake: 0, read: 1, bar0: 2, bar1: 3, bar2: 4, done: 5 };
