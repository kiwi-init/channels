import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import {
  at,
  BAR_V,
  BASE,
  BASE_TOP,
  BASE_Z,
  DESK,
  DESK_H,
  EXTRAS,
  FACE,
  FOOT_H,
  GLASS,
  HEIGHT,
  LID,
  LINE,
  lengthOf,
  P,
  PAPER_Y,
  planeMatrix,
  poseMatrix,
  printerPose,
  PRINTER,
  PRINTER_TOP,
  PRINTER_Z,
  PROMPT,
  ROWS_V,
  SLIP,
  slipLength,
  SLOT_Z,
  SPIKE,
  spikePose,
  STILL,
  needlePaths,
  screenAt,
  STACK,
  stackZ,
  TASKS,
  UP,
  WIDTH,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const num = (value) => Math.round(value * 100) / 100;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (x0, y0, x1, y1, r = 0, steps = 4) => k.pathOf(k.roundedPlan({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, steps), true);

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

function laptop() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, 0, 6, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BASE, 9))) out.push(S(k.cylinder(x, y, 3, 0, BASE_Z, P, 18), { tone: "lo" }));
  out.push(lid());
  out.push(S(k.slabOf(BASE, BASE_Z, BASE_TOP - BASE_Z, P, 6, 0.8), { tone: "hi", inner: L(k.sideSeam(BASE, BASE_Z + 2.4, P, 6), { tone: "faint" }) }));
  const U = 9.4;
  const cols = 12;
  const x0 = -U * (cols / 2);
  const y0 = BASE.y + 9;
  out.push(L(k.planOutline({ x: x0 - 1.4, y: y0 - 1.4, w: U * cols + 2.8, d: 8.2 * 5 + 2.8, r: 2 }, BASE_TOP, P, 4), { tone: "lo" }));
  const rows = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
    [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
    [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
    [1.5, 1.5, 6, 1.5, 1.5],
  ];
  rows.forEach((row, r) => {
    let x = x0;
    for (const width of row) {
      const plan = { x: x + 0.7, y: y0 + r * 8.2 + 0.7, w: width * U - 1.4, d: 8.2 - 1.4, r: 1.2 };
      out.push(S(k.slabOf(plan, BASE_TOP, 1, P, 3, 0.3), { tone: "mid", crease: "faint" }));
      x += width * U;
    }
  });
  const pad = { x: -24, y: y0 + 5 * 8.2 + 6, w: 48, d: 30, r: 3 };
  out.push(L(k.planOutline(pad, BASE_TOP, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(pad, 1.4), BASE_TOP, P, 4), { tone: "faint" }));
  for (const side of [-1, 1]) {
    const gx = side * (U * cols * 0.5 + 4.6);
    const holes = [];
    for (let i = 0; i < 9; i++) holes.push(k.planOutline({ x: gx - 1.6, y: y0 + i * 4.4, w: 3.2, d: 1.6, r: 0.8 }, BASE_TOP, P, 3));
    out.push(L(holes.join(""), { tone: "faint" }));
  }
  const side = k.sideMatrix([BASE.x + BASE.w, 0], 0, P, "right");
  const port = (y) => k.pathOf(k.roundedPlan({ x: -y - 3.4, y: -(BASE_Z + 4.6), w: 6.8, d: 2, r: 1 }, 3), true);
  out.push(`<g transform="${side}">${L(port(-4) + port(6), { tone: "lo" })}</g>`);
  return out.join("");
}

function lid() {
  const hinge = [0, LID.hingeY, LID.hingeZ];
  const F = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const top = [hinge[1] + UP[1] * LID.length, hinge[2] + UP[2] * LID.length];
  const back = [-FACE[1] * LID.thick, -FACE[2] * LID.thick];
  const poly = [
    [hinge[1], hinge[2]],
    [top[0], top[1]],
    [top[0] + back[0], top[1] + back[1]],
    [hinge[1] + back[0], hinge[2] + back[1]],
  ];
  const out = [S(G.prismOf(F, poly, BASE.x + 1, BASE.x + BASE.w - 1, P), { tone: "hi" })];
  const barrel = G.frameAlong([BASE.x + 22, LID.hingeY - 1.2, LID.hingeZ - 0.4], [1, 0, 0]);
  out.push(S(G.disc(0, BASE.w - 44, 1.8, barrel, P), { tone: "mid" }));
  out.push(screen(top));
  return out.join("");
}

function screen(top) {
  const o = [0, top[0], top[1]];
  const down = [0, -UP[1], -UP[2]];
  const M = planeMatrix(o, [1, 0, 0], down);
  const glass = rect(GLASS.x0, GLASS.v0, GLASS.x1, GLASS.v1, GLASS.r);
  const lines = screenAt(TASKS[STILL.task], STILL.c);
  const out = [`<g transform="${M}">`];
  out.push(`<clipPath id="loop-glass"><path d="${glass}"/></clipPath>`);
  out.push(`<path class="iso-shade" data-shade="0" d="${glass}"/>`);
  out.push(`<g clip-path="url(#loop-glass)">`);
  out.push(`<path class="iso-shade" data-shade="3" d="M${GLASS.x0} ${BAR_V}H${GLASS.x1}V${GLASS.v1}H${GLASS.x0}Z"/>`);
  out.push(L(`M${GLASS.x0} ${BAR_V}H${GLASS.x1}`, { tone: "faint" }));
  out.push(`<text class="iso-face-text" data-tone="lo" x="${GLASS.x0 + 3}" y="${BAR_V + 4.3}" font-size="3.6">[api] 0:kiwi loop*</text>`);
  out.push(`<text class="iso-face-text" data-tone="lo" x="${GLASS.x1 - 3}" y="${BAR_V + 4.3}" font-size="3.6" text-anchor="end">~/api</text>`);
  ROWS_V.forEach((v, i) => {
    const line = lines[i] ?? { text: "", tone: "mid", on: 0 };
    out.push(
      `<text class="iso-face-text" data-row="${i}" data-tone="${line.tone}" x="${GLASS.x0 + 4}" y="${v}" font-size="3.6" xml:space="preserve"${line.on ? "" : ' opacity="0"'}>${escape(line.text)}</text>`,
    );
  });
  out.push(`</g>`);
  out.push(L(glass, { tone: "lo" }));
  out.push(`</g>`);
  out.push(D([at([0, o[1] + down[1] * 2.6, o[2] + down[2] * 2.6])], { size: 0.6, tone: "mid" }));
  return out.join("");
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cable() {
  const r = 1;
  const route = G.fillet(
    [
      [BASE.x + BASE.w, 1, BASE_Z + 3.6],
      [BASE.x + BASE.w + 10, 1, BASE_Z + 3.6],
      [BASE.x + BASE.w + 16, 1, r],
      [PRINTER.x - 8, -24, r],
      [PRINTER.x + 6, -24, r],
    ],
    5,
    8,
    { P, tube: r },
  );
  const out = [S(k.slabOf({ x: BASE.x + BASE.w, y: -0.8, w: 5, d: 3.6, r: 0.8 }, BASE_Z + 2.2, 2.8, P, 3, 0.3), { tone: "mid" })];
  for (const piece of tubePieces(
    route.map(([x, y, z], i) => (i === 0 ? [x + 5, y, z] : [x, y, z])),
    r,
    P,
    { maxLength: 400 },
  ))
    out.push(tubeSvg(piece, { tone: "mid" }));
  return out.join("");
}

function printer() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PRINTER, 0, 6, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PRINTER, 7))) out.push(S(k.cylinder(x, y, 3, 0, PRINTER_Z, P, 18), { tone: "lo" }));
  out.push(S(k.slabOf(PRINTER, PRINTER_Z, PRINTER_TOP - PRINTER_Z, P, 6, 0.8), { tone: "hi", inner: L(k.sideSeam(PRINTER, PRINTER_Z + 5, P, 6), { tone: "faint" }) }));
  const F = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const cover = [
    [PRINTER.y + 3, PRINTER_TOP],
    [PAPER_Y - 1, PRINTER_TOP],
    [PAPER_Y - 1, PRINTER_TOP + 4.6],
    [PAPER_Y - 6, PRINTER_TOP + 9],
    [PAPER_Y - 14, PRINTER_TOP + 12.2],
    [PAPER_Y - 26, PRINTER_TOP + 13.4],
    [PAPER_Y - 38, PRINTER_TOP + 12.6],
    [PRINTER.y + 3, PRINTER_TOP + 9.6],
  ];
  out.push(S(G.prismOf(F, cover, PRINTER.x + 2.5, PRINTER.x + PRINTER.w - 2.5, P), { tone: "hi" }));
  const slot = [
    at([SLIP.x0 - 2, PAPER_Y - 1, PRINTER_TOP]),
    at([SLIP.x0 + SLIP.w + 2, PAPER_Y - 1, PRINTER_TOP]),
    at([SLIP.x0 + SLIP.w + 2, PAPER_Y + 0.9, PRINTER_TOP]),
    at([SLIP.x0 - 2, PAPER_Y + 0.9, PRINTER_TOP]),
  ];
  out.push(`<path class="iso-shade" data-shade="0" d="${k.pathOf(slot, true)}"/>`);
  out.push(L(k.pathOf(slot, true), { tone: "lo" }));
  const front = k.sideMatrix([0, PRINTER.y + PRINTER.d], 0, P, "left");
  const panel = rect(PRINTER.x + 8, -(PRINTER_TOP - 5), PRINTER.x + 26, -(PRINTER_TOP - 13), 1.4, 3);
  out.push(`<g transform="${front}">${L(panel, { tone: "lo" })}</g>`);
  out.push(D([at([PRINTER.x + 11.5, PRINTER.y + PRINTER.d, PRINTER_TOP - 9]), at([PRINTER.x + 16, PRINTER.y + PRINTER.d, PRINTER_TOP - 9])], { size: 0.7, tone: "hi" }));
  out.push(S(k.slabOf({ x: PRINTER.x + 19.5, y: PRINTER.y + PRINTER.d, w: 5, d: 1.2, r: 0.6 }, PRINTER_TOP - 11.4, 4.6, P, 3, 0.3), { tone: "mid" }));
  out.push(`<g transform="${front}"><text class="iso-face-text" data-tone="lo" x="${PRINTER.x + 32}" y="${-(PRINTER_TOP - 10.4)}" font-size="3">kiwi loop</text></g>`);
  out.push(S(k.slabOf({ x: PRINTER.x + PRINTER.w, y: PRINTER.y + 16, w: 1.4, d: 10, r: 0.7 }, PRINTER_TOP + 1, 5, P, 3, 0.3), { tone: "mid" }));
  out.push(
    D(
      k
        .corners({ x: PRINTER.x, y: PRINTER.y, w: PRINTER.w, d: PRINTER.d }, 3.4)
        .filter(([, y]) => y > PRINTER.y + 10)
        .map(([x, y]) => at([x, y, PRINTER_TOP])),
      { size: 0.45 },
    ),
  );
  return out.join("");
}

function tearBar() {
  const bar = { x: SLIP.x0 - 3, y: PAPER_Y + 0.9, w: SLIP.w + 6, d: 1.4, r: 0.4 };
  const out = [S(k.slabOf(bar, PRINTER_TOP, 3.2, P, 2, 0.2), { tone: "mid" })];
  const teeth = [];
  const z1 = PRINTER_TOP + 3.2;
  for (let x = bar.x, i = 0; x <= bar.x + bar.w + 1e-6; x += 1.5, i++) teeth.push(at([x, bar.y + bar.d, i % 2 ? z1 + 1 : z1]));
  out.push(`<path class="iso-shade" data-shade="2" d="${k.pathOf([at([bar.x, bar.y + bar.d, z1]), ...teeth, at([bar.x + bar.w, bar.y + bar.d, z1])], true)}"/>`);
  out.push(L(k.pathOf(teeth), { tone: "mid" }));
  return out.join("");
}

function spindleBase() {
  const { x, y, r, foot, h, boss } = SPIKE;
  const top = foot + h;
  const plan = { x: x - r, y: y - r, w: r * 2, d: r * 2, r };
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, 4, P)}"/>`];
  out.push(S(k.cylinder(x, y, r - 2.4, 0, foot, P, 48, 0.2), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, r, foot, h, P, 64, 0.8), { tone: "mid", inner: L(k.sideArc(x, y, r, foot + 1.5, P, 48), { tone: "faint" }) }));
  out.push(L(k.ring(x, y, r - 3.2, top, P, 56), { tone: "faint" }));
  out.push(L(k.ring(x, y, r - 4.4, top, P, 56), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 5, top, 0.8, P, 32, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 3, top + 0.8, boss - top - 0.8, P, 24, 0.3), { tone: "mid" }));
  return out.join("");
}

function needleSvg(z0, z1, tip, index) {
  const paths = needlePaths(z0, z1, tip);
  const ds = paths ? [paths.fill, ...paths.shades, paths.top, paths.outline] : ["", "", "", "", "", "", ""];
  return [
    `<g class="iso-solid" data-needle="${index}">`,
    `<path class="iso-fill" d="${ds[0]}"/>`,
    ...[0, 1, 2, 3].map((shade) => `<path class="iso-shade" data-shade="${shade}" d="${ds[1 + shade]}"/>`),
    `<path class="iso-top" d="${ds[5]}"/>`,
    `<path class="iso-line iso-edge" data-tone="hi" d="${ds[6]}"/>`,
    `</g>`,
  ].join("");
}

function zigzag(y, from, to) {
  const out = [];
  const n = Math.round(Math.abs(to - from) / 1.5);
  for (let i = 0; i <= n; i++) out.push([from + ((to - from) * i) / n, y + (i % 2 ? 0.7 : 0)]);
  return out;
}

export function slipBody(task, length, lit) {
  const w = SLIP.w;
  const edge = [...zigzag(0, 0, w), ...zigzag(length, w, 0)];
  const shape = k.pathOf(edge, true);
  const t = (y, size, tone, text) => `<text class="iso-face-text" data-tone="${tone}" x="2.6" y="${y}" font-size="${size}">${escape(text)}</text>`;
  const out = [`<path class="iso-face-text" data-tone="faint" d="${shape}"/>`];
  out.push(t(8.2, 4.8, "hi", task.head));
  out.push(t(13.6, 3.5, "mid", task.title));
  out.push(L(`M0 16.8H${w}`, { tone: "lo" }));
  out.push(t(21.8, 3.4, "mid", task.end));
  out.push(t(26.4, 3.1, "lo", task.nonce));
  const bars = task.work.map((_, i) => `M2.6 ${num(PROMPT + LINE * i + 0.8)}H${num(2.6 + [34, 25, 39, 21, 30][(i + task.head.length) % 5])}`);
  out.push(L(bars.join(""), { tone: "lo", free: true }));
  out.push(t(PROMPT + LINE * task.work.length + 4, 3.4, "hi", task.done));
  out.push(L(shape, { tone: "hi" }));
  if (lit !== undefined) out.push(`<g data-lit=""${lit ? "" : ' opacity="0"'}>${L(shape, { tone: "lit" })}</g>`);
  return out.join("");
}

function stack() {
  const out = [needleSvg(SPIKE.boss, stackZ(0), false, "base")];
  STACK.forEach((slip, i) => {
    const pose = spikePose(slip.length, stackZ(i), slip.angle);
    out.push(`<g transform="${poseMatrix(pose)}">${slipBody(TASKS[slip.task], slip.length)}</g>`);
    const next = i < STACK.length - 1 ? stackZ(i + 1) : SPIKE.tip;
    out.push(needleSvg(stackZ(i), next, i === STACK.length - 1, `s${i}`));
  });
  return out.join("");
}

function printerClip() {
  const left = at([SLIP.x0 - 30, PAPER_Y, SLOT_Z]);
  const right = at([SLIP.x0 + SLIP.w + 30, PAPER_Y, SLOT_Z]);
  return `<clipPath id="loop-slot"><path d="${k.pathOf([left, right, [right[0], -400], [left[0], -400]], true)}"/></clipPath>`;
}

function extras() {
  const out = [printerClip()];
  for (let i = 0; i < EXTRAS; i++) {
    const task = TASKS[i % TASKS.length];
    const full = lengthOf(task, task.work.length + 1);
    const live = i === 0;
    const pose = printerPose(live ? slipLength(task, STILL.c) : 0);
    out.push(
      `<g data-slip="${i}"${live ? ' clip-path="url(#loop-slot)"' : ' opacity="0" clip-path="url(#loop-slot)"'}><g data-pose="" transform="${poseMatrix(pose)}">${slipBody(task, full, live)}</g></g>`,
    );
    out.push(needleSvg(0, 0, true, `x${i}`));
  }
  return out.join("");
}

export default function figure() {
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A laptop on a desk running kiwi loop in a tmux window, with a receipt printer beside it and a receipt spike in front. For each piece of work the printer feeds a fresh slip printed with that session's first prompt, task T7, and the laptop starts a new session on it. As the session works the slip grows a little; when the work is done the slip is torn off and spiked on top of the earlier short slips, and the printer starts a fresh short slip for the next task: a review, another task, then messages.",
    body: [desk(), laptop(), cable(), printer(), spindleBase(), stack(), extras(), tearBar()],
  });
}
