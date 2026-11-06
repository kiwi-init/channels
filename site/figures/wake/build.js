import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import {
  AGENTS,
  at,
  BAR_Z,
  BOX,
  BOX_Z,
  BOXES,
  DESK,
  DESK_H,
  faceMatrix,
  FLAG,
  flagSolids,
  FOOT_H,
  GLASS,
  HEIGHT,
  KB,
  LETTER,
  liveSolid,
  MON,
  P,
  PANE_W,
  paneX,
  PLANK,
  PLANK_H,
  PLANK_Z,
  RIDGE_Z,
  ROOF_Z,
  roofZ,
  SLOT_Y,
  STAND,
  STILL,
  WIDTH,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const flat = (x0, z0, x1, z1, r, steps = 6) =>
  k.pathOf(
    k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z]),
    true,
  );
const rightMatrix = (x) => k.sideMatrix([x, 0], 0, P, "right");
const num = (value) => Math.round(value * 100) / 100;

function recess({ x0, x1, z0, z1, r, depth }, y, back, inside) {
  const ring = k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const { sinA } = k.cameraOf(P);
  const tops = [];
  const sides = [[], [], [], []];
  ring.forEach(([ax, az], index) => {
    const [bx, bz] = ring[(index + 1) % ring.length];
    const length = Math.hypot(bx - ax, bz - az) || 1;
    let [nx, nz] = [(bz - az) / length, -(bx - ax) / length];
    if (nx * (cx - (ax + bx) / 2) + nz * (cz - (az + bz) / 2) < 0) [nx, nz] = [-nx, -nz];
    if (nx <= 0 && nz <= 0) return;
    const quad = k.pathOf([at([ax, y, az]), at([bx, y, bz]), at([bx, y - depth, bz]), at([ax, y - depth, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))].push(quad);
  });
  const shape = flat(x0, z0, x1, z1, r, 4);
  return [
    `<clipPath id="wake-glass"><path transform="${faceMatrix(y)}" d="${shape}"/></clipPath>`,
    `<g clip-path="url(#wake-glass)">`,
    `<path class="iso-top" d="${tops.join("")}"/>`,
    ...sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")),
    `<g transform="${faceMatrix(y - depth)}"><path class="iso-shade" data-shade="0" d="${shape}"/>${back}<path class="iso-line" data-tone="faint" d="${shape}"/></g>`,
    inside,
    `</g>`,
    `<g transform="${faceMatrix(y)}"><path class="iso-line" data-tone="mid" d="${shape}"/></g>`,
  ].join("");
}

function desk() {
  const out = [`<path class="iso-halo" d="${k.haloOf(DESK, -DESK_H - FOOT_H, DESK_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(DESK, 22))) {
    out.push(S(k.cylinder(x, y, 7, -DESK_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -DESK_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(DESK, -DESK_H, DESK_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(DESK, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(DESK, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(
    D(
      screws.map(([x, y]) => at([x, y, 0])),
      { size: 0.5 },
    ),
  );
  return out.join("");
}

function monitorStand() {
  const foot = { x: -36, y: -54, w: 72, d: 40, r: 8 };
  const out = [`<path class="iso-halo" d="${k.haloOf(foot, 0, 4, P)}"/>`];
  out.push(S(k.slabOf(foot, 0, 2.4, P, 8, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(foot, 3), 2.4, P, 8), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -13, y: -46, w: 26, d: 6, r: 2 }, 2.4, 70, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -11, y: -40, w: 22, d: 14, r: 2 }, 58, 14, P, 4, 0.4), { tone: "mid" }));
  return out.join("");
}

function monitor() {
  const body = { x: MON.x0, y: MON.back, w: MON.x1 - MON.x0, d: MON.front - MON.back, r: 3 };
  const out = [];
  out.push(S(k.slabOf(body, MON.z0, MON.z1 - MON.z0, P, 4, 0.8), { tone: "hi", inner: L(k.sideSeam(body, GLASS.z0 - 3, P, 4), { tone: "faint" }) }));
  const vents = [];
  for (let x = -66; x <= 66; x += 4.4) vents.push(k.planOutline({ x: x - 0.8, y: MON.back + 2.6, w: 1.6, d: 4.4, r: 0.8 }, MON.z1, P, 3));
  out.push(L(vents.join(""), { tone: "faint" }));
  const side = rightMatrix(MON.x1);
  const ports = [flat(-MON.back - 7.2, MON.z0 + 9, -MON.back - 3.4, MON.z0 + 10.6, 0.8, 3), flat(-MON.back - 7.2, MON.z0 + 14, -MON.back - 3.4, MON.z0 + 15.6, 0.8, 3)];
  out.push(`<g transform="${side}">${L(ports.join(""), { tone: "lo" })}</g>`);
  out.push(L(k.sideRing([MON.x1, MON.back + 5.3, MON.z0 + 21], 1, "x", P, 16), { tone: "lo" }));
  out.push(recess(GLASS, MON.front, screen(), ""));
  out.push(D([at([MON.x1 - 12, MON.front, MON.z0 + 7.5])], { size: 0.8, tone: "hi" }));
  out.push(L(k.sideRing([0, MON.front, GLASS.z1 + 3], 1.3, "y", P, 16), { tone: "lo" }));
  out.push(D([at([0, MON.front, GLASS.z1 + 3])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function screen() {
  const out = [];
  const bar = { z0: GLASS.z0, z1: BAR_Z };
  out.push(`<path class="iso-shade" data-shade="3" d="M${GLASS.x0} ${-bar.z1}H${GLASS.x1}V${-bar.z0}H${GLASS.x0}Z"/>`);
  out.push(L(`M${GLASS.x0} ${-bar.z1}H${GLASS.x1}`, { tone: "faint" }));
  out.push(`<text class="iso-face-text" data-tone="lo" x="${GLASS.x0 + 3}" y="${-(bar.z0 + 2)}" font-size="4">[work] 0:agents*</text>`);
  out.push(`<text class="iso-face-text" data-tone="lo" x="${GLASS.x1 - 3}" y="${-(bar.z0 + 2)}" font-size="4" text-anchor="end">14:22</text>`);
  for (let i = 1; i < 3; i++) out.push(L(`M${num(paneX(i) - 0.5)} ${-GLASS.z1}V${-BAR_Z}`, { tone: "lo" }));
  AGENTS.forEach((agent, i) => out.push(pane(agent, i, i === STILL)));
  return out.join("");
}

function pane(agent, i, awake) {
  const x0 = paneX(i);
  const left = i === 0 ? GLASS.x0 : num(x0 - 0.5);
  const right = i === 2 ? GLASS.x1 : num(x0 + PANE_W + 0.5);
  const tx = num(x0 + 3);
  const text = (z, line, tone, value, size = 4.2, extra = "") => `<text class="iso-face-text" data-tone="${tone}" data-line="${line}" x="${tx}" y="${-z}" font-size="${size}"${extra}>${value}</text>`;
  const bar = (z, length, tone, line) =>
    `<path class="iso-line" data-tone="${tone}" data-free=""${line === undefined ? "" : ` data-line="${line}"`} d="M${tx} ${-z}H${num(tx + length)}"${line === undefined ? "" : ' opacity="0"'}/>`;
  const shown = (on) => (on ? "" : ' opacity="0"');
  const out = [`<g data-pane="${i}">`];
  out.push(`<rect class="iso-face-text" data-tone="faint" data-glow="" x="${num(x0)}" y="${-GLASS.z1}" width="${num(PANE_W)}" height="${GLASS.z1 - BAR_Z}"${shown(awake)}/>`);
  out.push(`<text class="iso-face-text" data-tone="mid" x="${tx}" y="${-(GLASS.z1 - 5.6)}" font-size="3.8">${agent.name}</text>`);
  out.push(L(`M${left} ${-(GLASS.z1 - 8)}H${right}`, { tone: "faint" }));
  out.push(bar(GLASS.z1 - 13, 30 - i * 4, "faint"));
  out.push(bar(GLASS.z1 - 16.5, 20 + i * 5, "faint"));
  out.push(text(118, 0, "hi", agent.wake, 3.9, shown(awake)));
  out.push(text(111, 1, "mid", agent.read, 3.9, ' opacity="0"'));
  [26, 34, 18].forEach((length, j) => out.push(bar(106 - j * 3.5, length, "lo", 2 + j)));
  out.push(text(92, 5, "hi", agent.done, 3.9, ' opacity="0"'));
  out.push(text(BAR_Z + 4.5, "prompt", "mid", agent.wake[0], 3.9));
  out.push(`<rect class="iso-face-text" data-tone="${awake ? "hi" : "lo"}" data-cursor="" x="${num(tx + 3.6)}" y="${-(BAR_Z + 8)}" width="2.4" height="4"/>`);
  out.push(`</g>`);
  return out.join("");
}

const ROWS = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
  [1.5, 1.5, 9, 1.5, 1.5],
];

function keyboard() {
  const U = 8.8;
  const top = 6;
  const out = [`<path class="iso-halo" d="${k.haloOf(KB, 0, 4, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(KB, 8))) out.push(S(k.cylinder(x, y, 2.6, 0, 1.4, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf(KB, 1.4, top - 1.4, P, 6, 1), { tone: "mid" }));
  const x0 = KB.x + (KB.w - U * 15) / 2;
  const y0 = KB.y + 3;
  out.push(L(k.planOutline({ x: x0 - 1.2, y: y0 - 1.2, w: U * 15 + 2.4, d: U * 5 + 2.4, r: 2 }, top, P, 4), { tone: "lo" }));
  ROWS.forEach((row, r) => {
    let x = x0;
    for (const width of row) {
      const plan = { x: x + 0.7, y: y0 + r * U + 0.7, w: width * U - 1.4, d: U - 1.4, r: 1.3 };
      const h = 2.8 - r * 0.3;
      out.push(S(k.slabOf(plan, top, h, P, 3, 0.4), { tone: "mid", crease: "faint" }));
      out.push(L(k.planOutline(k.insetPlan(plan, 1.5), top + h, P, 3), { tone: "faint" }));
      x += width * U;
    }
  });
  return out.join("");
}

const BASE_H = 5;
const PORT = { y: MON.back + 5.3, z: MON.z0 + 9.8 };
const PLUG = { x: STAND.x - 22, y: STAND.y, z: 2.5 };

function plugShell(x0, x1, y, z) {
  const out = [S(k.slabOf({ x: x0, y: y - 1.8, w: x1 - x0, d: 3.6, r: 0.8 }, z - 1.6, 3.2, P, 3, 0.3), { tone: "mid" })];
  out.push(L(k.sideSeam({ x: x0, y: y - 1.8, w: x1 - x0, d: 3.6, r: 0.8 }, z, P, 3), { tone: "faint" }));
  return out.join("");
}

function cable() {
  const r = 1.1;
  const route = G.fillet(
    [
      [MON.x1 + 6, PORT.y, PORT.z],
      [MON.x1 + 13, PORT.y, PORT.z],
      [MON.x1 + 13, PORT.y, r],
      [MON.x1 + 24, PLUG.y - 6, r],
      [PLUG.x - 5, PLUG.y, r],
    ],
    5,
    8,
    { P, tube: r },
  );
  const out = [plugShell(MON.x1, MON.x1 + 6, PORT.y, PORT.z)];
  for (const piece of tubePieces(route, r, P, { maxLength: 400 })) out.push(tubeSvg(piece, { tone: "mid" }));
  out.push(plugShell(PLUG.x - 5, PLUG.x + 0.6, PLUG.y, r + 0.4));
  return out.join("");
}

function gusset(side) {
  const F = G.frameOf([STAND.x, STAND.y - 1.2, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const inner = side * 3.5;
  const outer = side * 22;
  return S(
    G.prismOf(
      F,
      [
        [inner, PLANK_Z],
        [outer, PLANK_Z],
        [inner, PLANK_Z - 18],
      ],
      0,
      2.4,
      P,
    ),
    { tone: "mid" },
  );
}

function stand() {
  const base = { x: STAND.x - 22, y: STAND.y - 22, w: 44, d: 44, r: 22 };
  const out = [`<path class="iso-halo" d="${k.haloOf(base, 0, 4, P)}"/>`];
  out.push(S(k.cylinder(STAND.x, STAND.y, 22, 0, BASE_H, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(STAND.x, STAND.y, 22, 1.6, P, 40), { tone: "faint" }) }));
  const bolts = [45, 135, 225, 315].map((deg) => [STAND.x + 16 * Math.cos((deg * Math.PI) / 180), STAND.y + 16 * Math.sin((deg * Math.PI) / 180)]);
  out.push(L(bolts.map(([x, y]) => k.ring(x, y, 1.8, BASE_H, P, 14)).join(""), { tone: "lo" }));
  out.push(
    D(
      bolts.map(([x, y]) => at([x, y, BASE_H])),
      { size: 0.5 },
    ),
  );
  out.push(S(k.cylinder(STAND.x, STAND.y, 8, BASE_H, 3.6, P, 32, 0.4), { tone: "mid" }));
  out.push(gusset(-1));
  out.push(S(k.slabOf({ x: STAND.x - 3.5, y: STAND.y - 3.5, w: 7, d: 7, r: 1 }, BASE_H + 3.6, PLANK_Z - BASE_H - 3.6, P, 3, 0.4), { tone: "mid" }));
  out.push(gusset(1));
  out.push(S(k.slabOf(PLANK, PLANK_Z, PLANK_H, P, 3, 0.6), { tone: "mid" }));
  out.push(L([PLANK.y + 9, PLANK.y + 22, PLANK.y + 33].map((y) => k.lineOnTop([PLANK.x, y], [PLANK.x + PLANK.w, y], PLANK_Z + PLANK_H, P)).join(""), { tone: "faint" }));
  const front = faceMatrix(PLANK.y + PLANK.d);
  out.push(`<g transform="${front}"><text class="iso-face-text" data-tone="lo" x="${PLANK.x + 6}" y="${-(PLANK_Z + 1.8)}" font-size="3.4">kiwi daemon</text></g>`);
  out.push(
    D(
      k.corners(PLANK, 4).map(([x, y]) => at([x, y, PLANK_Z + PLANK_H])),
      { size: 0.5 },
    ),
  );
  BOXES.forEach((bx, i) => out.push(mailbox(bx, i)));
  return out.join("");
}

function tombstone(half, wall, inset = 0, steps = 16) {
  const r = half - inset;
  const out = [
    [-r, inset],
    [r, inset],
  ];
  for (let s = 0; s <= steps; s++) {
    const a = (s / steps) * Math.PI;
    out.push([r * Math.cos(a), wall + r * Math.sin(a)]);
  }
  return out;
}

function mailbox(bx, i) {
  const length = BOX.front - BOX.back;
  const F = G.frameOf([bx, BOX.back, BOX_Z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const flange = { x: bx - 14, y: BOX.back - 2, w: 28, d: length + 4, r: 1.4 };
  const out = [];
  out.push(S(k.slabOf(flange, PLANK_Z + PLANK_H, 1.2, P, 3, 0.3), { tone: "mid" }));
  out.push(
    D(
      k.corners(flange, 1.6).map(([x, y]) => at([x, y, BOX_Z])),
      { size: 0.45 },
    ),
  );
  out.push(S(G.prismOf(F, tombstone(BOX.half, BOX.wall), 0, length, P), { tone: "hi", inner: L([BOX.back + 5, BOX.front - 5].map((y) => band(bx, y)).join(""), { tone: "lo" }) }));
  out.push(D([at([bx + BOX.half, BOX.back + 2.4, BOX_Z + 2]), at([bx + BOX.half, BOX.front - 2.4, BOX_Z + 2])], { size: 0.45 }));
  out.push(S(G.prismOf(F, tombstone(BOX.half, BOX.wall, 1.4), length, length + 0.7, P), { tone: "hi" }));
  out.push(S(k.slabOf({ x: bx - 2.4, y: BOX.front + 0.7, w: 4.8, d: 1.6, r: 0.6 }, RIDGE_Z - 6, 2.6, P, 3), { tone: "hi" }));
  const hinge = G.frameAlong([bx - 8, BOX.front + 1.3, BOX_Z + 1.4], [1, 0, 0]);
  out.push(S(G.disc(0, 16, 0.7, hinge, P), { tone: "mid" }));
  out.push(slot(bx));
  out.push(letter(bx, i));
  out.push(flag(i));
  const pivot = G.frameAlong([bx + BOX.half + FLAG.x1, FLAG.y, FLAG.z], [1, 0, 0]);
  out.push(S(G.disc(0, 0.8, 1.5, pivot, P), { tone: "hi" }));
  return out.join("");
}

function band(bx, y) {
  const [vx, , vz] = G.viewOf(P);
  const limb = Math.atan2(vx, -vz) - 0.01;
  const points = [at([bx + BOX.half, y, BOX_Z])];
  for (let s = 0; s <= 24; s++) {
    const a = (limb * s) / 24;
    points.push(at([bx + BOX.half * Math.cos(a), y, ROOF_Z + BOX.half * Math.sin(a)]));
  }
  return k.pathOf(points);
}

function slot(bx) {
  const half = 8;
  const steps = 12;
  const edge = (y) =>
    Array.from({ length: steps + 1 }, (_, s) => {
      const dx = -half + (2 * half * s) / steps;
      return at([bx + dx, y, roofZ(dx)]);
    });
  const d = k.pathOf([...edge(SLOT_Y - 1.3), ...edge(SLOT_Y + 1.3).reverse()], true);
  return `<path class="iso-shade" data-shade="0" d="${d}"/>${L(d, { tone: "lo" })}`;
}

function letter(bx, i) {
  const F = G.frameOf([bx, BOX.back, BOX_Z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const front = G.prismOf(F, tombstone(BOX.half, BOX.wall), SLOT_Y - BOX.back, BOX.front - BOX.back + 2.4, P).fill;
  const clip = `M-200 -200H${WIDTH + 200}V${HEIGHT + 200}H-200Z${front}`;
  const x0 = bx - LETTER.w / 2;
  const x1 = bx + LETTER.w / 2;
  const top = -(LETTER.top + LETTER.h);
  const bottom = -LETTER.top;
  const tip = [bx, top + LETTER.h * 0.56];
  const body = flat(x0, LETTER.top, x1, LETTER.top + LETTER.h, 0.8, 3);
  const envelope = [
    `<path class="iso-top" d="${body}"/>`,
    L(
      k.pathOf([
        [x0, bottom],
        [bx, top + LETTER.h * 0.42],
        [x1, bottom],
      ]),
      { tone: "lo" },
    ),
    `<path class="iso-top" d="${k.pathOf([[x0 + 0.4, top + 0.4], tip, [x1 - 0.4, top + 0.4]], true)}"/>`,
    L(k.pathOf([[x0, top], tip, [x1, top]]), { tone: "mid" }),
    L(body, { tone: "hi" }),
    `<circle class="iso-face-text" data-tone="hi" cx="${tip[0]}" cy="${num(tip[1])}" r="1.7"/>`,
  ].join("");
  return [
    `<clipPath id="wake-letter-${i}"><path clip-rule="evenodd" d="${clip}"/></clipPath>`,
    `<g clip-path="url(#wake-letter-${i})"><g transform="${faceMatrix(SLOT_Y)}"><g data-letter="${i}" opacity="0">${envelope}</g></g></g>`,
  ].join("");
}

function flag(i) {
  const lift = i === STILL ? 1 : 0;
  const [arm, plate] = flagSolids(i, lift);
  return [
    `<g data-flag="${i}">`,
    liveSolid(arm, { tone: "hi" }),
    liveSolid(plate, { tone: "hi" }),
    `<g data-flag-lit=""${lift ? "" : ' opacity="0"'}>`,
    liveSolid(arm, { tone: "hi", lit: true }),
    liveSolid(plate, { tone: "hi", lit: true }),
    `</g>`,
    `</g>`,
  ].join("");
}

export default function figure() {
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A desk with one computer and, beside it, a post holding a row of three small mailboxes, one for each agent on that computer. The screen is split into three terminal panes: claude, codex and gemini. A sealed letter drops into one mailbox, its flag springs up, and only that agent's pane wakes: the line New Kiwi messages appears, the agent runs kiwi join to read them, and the flag drops again. The other two panes sleep on.",
    body: [desk(), monitorStand(), monitor(), keyboard(), cable(), stand()],
  });
}
