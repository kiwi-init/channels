import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import {
  BASE,
  BOARD,
  BOARD_H,
  BOXES,
  CLIP_SHIFT,
  DIE_R,
  DISPLAY,
  DISPLAY_H,
  DISPLAY_W,
  H,
  JAW_Z,
  LAPTOPS,
  LID,
  LID_OUT,
  LID_UP,
  OUT_LINES,
  P,
  PAD,
  PAD_SHIFT,
  PAD_TOP,
  POSTS,
  PRINTS,
  RAIL,
  REST,
  SHEET,
  SHEET_Z,
  SLOT,
  STAGES,
  STAGE_STEP,
  STAGE_Y0,
  STAMP_AT,
  TICKET,
  TX,
  W,
  displayMatrix,
  lidCentre,
  lidOrigin,
  outLine,
  poseAt,
  sheetAt,
  stageOffset,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const at = (point) => k.iso(point, P);
const halo = (plan, z, h) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const pathIn = (points) => k.pathOf(points.map(at), true);
const onSheet = (points) =>
  k.onTop(
    points.map(([u, v]) => sheetAt(u, v)),
    SHEET_Z,
    P,
  );
const fixed = (value) => Math.round(value * 100) / 100;
const move = (offset) => k.translateAlong(P, offset);

function frontSlot(y, x0, x1, z0, z1, r) {
  return pathIn(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4).map(([x, z]) => [x, y, z]));
}

function post(y) {
  const x = TX - 4;
  const out = [halo({ x: x - 9, y: y - 9, w: 18, d: 18, r: 9 }, 0, 2)];
  out.push(S(k.cylinder(x, y, 8, 0, 2, P, 40, 0.4), { tone: "lo" }));
  const screws = [0.6, 2.2, 3.8].map((a) => [x + 5.4 * Math.cos(a), y + 5.4 * Math.sin(a)]);
  out.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.1, 2, P, 12)).join(""), { tone: "faint" }));
  out.push(
    D(
      screws.map(([sx, sy]) => at([sx, sy, 2])),
      { size: 0.45 },
    ),
  );
  out.push(S(k.cylinder(x, y, 3.6, 2, 3, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 2.4, 5, RAIL.z - 14, P, 24), { tone: "mid", crease: "none", inner: L(k.sideArc(x, y, 2.4, 60, P, 16), { tone: "faint" }) }));
  out.push(S(k.cylinder(x, y, 4, RAIL.z - 9, 9, P, 28, 0.4), { tone: "mid", inner: L(k.sideArc(x, y, 4, RAIL.z - 5, P, 16), { tone: "faint" }) }));
  return out.join("");
}

function capOf(y) {
  return S(k.slabOf({ x: TX - 9, y, w: 13, d: 3, r: 1 }, RAIL.z - 4, RAIL.h + 5.5, P, 3, 0.4), { tone: "lo" });
}

function railBack() {
  const out = POSTS.map(post);
  out.push(capOf(RAIL.y0 - 3));
  const body = { x: TX - 8, y: RAIL.y0, w: 8, d: RAIL.y1 - RAIL.y0, r: 1.5 };
  out.push(S(k.slabOf(body, RAIL.z, RAIL.h, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(body, RAIL.z + 3, P, 3), { tone: "faint" }) }));
  return out.join("");
}

function railFront() {
  const lip = { x: TX + 1, y: RAIL.y0, w: 2.2, d: RAIL.y1 - RAIL.y0, r: 0.6 };
  const out = [
    S(k.slabOf(lip, RAIL.z - 4, RAIL.h + 1, P, 2), { tone: "mid", inner: L(k.segment([lip.x + lip.w, RAIL.y0, RAIL.z + 1.5], [lip.x + lip.w, RAIL.y1, RAIL.z + 1.5], P), { tone: "faint" }) }),
  ];
  const screws = [RAIL.y0 + 14, -205, RAIL.y1 - 14].map((y) => at([lip.x + lip.w, y, RAIL.z + 4]));
  out.push(D(screws, { size: 0.55, tone: "mid" }));
  const balls = [];
  for (let y = RAIL.y0 + 6; y < RAIL.y1 - 3; y += 9) balls.push(at([lip.x + 0.4, y, RAIL.z - 4]));
  out.push(D(balls, { size: 0.5, tone: "lo" }));
  out.push(capOf(RAIL.y1));
  return out.join("");
}

function ticket(index, name) {
  const x = TX + 0.2;
  const plan = { x, y: -TICKET.w / 2, w: 0.6, d: TICKET.w, r: 0.2 };
  const face = k.sideMatrix([x + 0.6, TICKET.w / 2], TICKET.z1, P, "right");
  const rules = [
    [23, 22],
    [27.5, 17],
    [32, 11],
  ];
  const marks = [
    `<text class="iso-face-text" data-tone="hi" x="3" y="14.6" font-size="6.2">${name}</text>`,
    L(`M0 17.6H${TICKET.w}`, { tone: "lo" }),
    L(rules.map(([v, w]) => `M3 ${v}H${3 + w}`).join(""), { tone: "lo", free: true }),
  ];
  const body = S(k.slabOf(plan, TICKET.z0, TICKET.z1 - TICKET.z0, P, 2), { tone: "hi", crease: "none" });
  return `<g data-part="ticket" data-index="${index}">${body}<g transform="${face}">${marks.join("")}</g></g>`;
}

function tickets(pose) {
  return pose.tickets
    .map((state, index) => {
      const g = ticket(index, `T${index + 1}`);
      return g.replace(`data-index="${index}">`, `data-index="${index}" transform="${move([0, state.y, state.z])}" opacity="${fixed(state.on)}">`);
    })
    .join("");
}

function keys(laptop) {
  const out = [];
  const rows = [Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), [1.5, 1, 1.2, 4.6, 1.2, 1, 1.5]];
  const top = BASE.z + BASE.h;
  const pitch = 118 / 12;
  rows.forEach((row, r) => {
    let y = laptop.y + 11;
    const x = laptop.x + 12.5 + r * 8.8;
    for (const width of row) {
      const plan = { x, y: y + 0.8, w: 7.2, d: width * pitch - 1.6, r: 1 };
      out.push(S(k.slabOf(plan, top, 0.8, P, 2), { tone: "mid", crease: "faint" }));
      y += width * pitch;
    }
  });
  return out.join("");
}

function screen(laptop, index, state) {
  const shape = k.pathOf(k.roundedPlan({ x: 0, y: 0, w: DISPLAY_W, d: DISPLAY_H, r: 2.4 }, 4), true);
  const bar = 9;
  const lines = OUT_LINES;
  const parts = [
    `<path class="iso-fill" d="${shape}"/>`,
    L(`M0 ${bar}H${DISPLAY_W}`, { tone: "faint" }),
    D(
      [0, 1, 2].map((i) => [5 + i * 4.4, bar / 2]),
      { size: 1.1, tone: "faint" },
    ),
    `<text class="iso-face-text" data-tone="lo" x="6" y="20" font-size="6.4">${laptop.harness}</text>`,
    `<text class="iso-face-text" data-tone="hi" data-part="task" x="6" y="32" font-size="8.4">${state.task ? `› ${state.task}` : "›"}</text>`,
    `<path class="iso-line" data-tone="hi" data-part="check" data-free="" d="M34 28.2L37 31.2L43.4 24.2" opacity="${state.done ? 1 : 0}"/>`,
    ...lines.map((y, i) => `<path class="iso-line" data-tone="mid" data-part="out" data-free="" d="${outLine(y, i, state)}"/>`),
    L(shape, { tone: "lo" }),
  ];
  return `<g data-part="screen" data-index="${index}" transform="${displayMatrix(laptop)}">${parts.join("")}</g>`;
}

function ports(laptop) {
  const y = laptop.y + BASE.d;
  const z0 = BASE.z + 2.2;
  const z1 = BASE.z + 4.4;
  const slots = [frontSlot(y, laptop.x + 14, laptop.x + 22, z0, z1, 1.1), frontSlot(y, laptop.x + 26, laptop.x + 34, z0, z1, 1.1), frontSlot(y, laptop.x + 42, laptop.x + 46, z0 + 0.2, z1 - 0.2, 1)];
  return L(slots.join(""), { tone: "lo" }) + D([at([laptop.x + 80, y, BASE.z + 3.3])], { size: 0.7, tone: "hi" });
}

function laptop(item, index, state) {
  const plan = { x: item.x, y: item.y, w: BASE.w, d: BASE.d, r: 6 };
  const top = BASE.z + BASE.h;
  const out = [halo(plan, 0, BASE.z + BASE.h)];
  for (const [x, y] of byDepth(k.corners(plan, 10))) out.push(S(k.cylinder(x, y, 3, 0, BASE.z, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf(plan, BASE.z, BASE.h, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, BASE.z + 2, P, 6), { tone: "faint" }) }));
  out.push(ports(item));
  out.push(L(k.planOutline({ x: item.x + 10.5, y: item.y + 9.6, w: 46, d: 120.8, r: 2 }, top, P, 4), { tone: "faint" }));
  out.push(keys(item));
  const pad = { x: item.x + 62, y: item.y + 44, w: 26, d: 52, r: 3 };
  out.push(L(k.planOutline(pad, top, P, 4), { tone: "lo" }));
  const hinge = G.frameAlong([item.x + 4, lidCentre(item), top + 2.2], [0, 1, 0]);
  out.push(S(G.disc(-58, 58, 2.2, hinge, P), { tone: "mid" }));
  const o = lidOrigin(item);
  const F = G.frameOf(o, LID_OUT, [0, -1, 0], LID_UP);
  const outline = k.roundedPlan({ x: -LID.w / 2, y: 0, w: LID.w, d: LID.h, r: 6 }, 6);
  out.push(S(G.prismOf(F, outline, -LID.t, 0, P), { tone: "mid" }));
  const camera = add(add(o, LID_UP, LID.h - DISPLAY.top / 2), LID_OUT, 0.05);
  out.push(L(G.circleOf(G.frameAlong(camera, LID_OUT), 0, 1.1, P, 16), { tone: "lo" }));
  out.push(screen(item, index, state));
  const chin = add(add(o, LID_UP, DISPLAY.bottom / 2), LID_OUT, 0.05);
  out.push(L(k.pathOf([at(add(chin, [0, 1, 0], 7)), at(add(chin, [0, -1, 0], 7))]), { tone: "faint", free: true }));
  return out.join("");
}

function sheetText() {
  const rule = (v, u0, u1) =>
    onSheet([
      [u0, v],
      [u1, v],
    ]);
  const box = (v) =>
    onSheet([
      [8, v],
      [17, v],
      [17, v + 9],
      [8, v + 9],
      [8, v],
    ]);
  return [
    L(rule(23.4, 8, 60) + rule(24.4, 8, 60), { tone: "hi", free: true }),
    L(rule(33, 8, 84) + rule(38, 8, 66), { tone: "mid", free: true }),
    L(rule(49.6, 8, 40) + rule(50.4, 8, 40), { tone: "hi", free: true }),
    L(box(BOXES[0]) + box(BOXES[1]), { tone: "hi" }),
    L(rule(BOXES[0] + 4.5, 22, 80) + rule(BOXES[1] + 4.5, 22, 66), { tone: "mid", free: true }),
    L(rule(94, 8, 26), { tone: "mid", free: true }),
    L(rule(100, 8, 62) + rule(105, 8, 46), { tone: "lo", free: true }),
  ].join("");
}

function printPaths([cx, cy]) {
  const z = SHEET_Z;
  const rings = k.ring(cx, cy, DIE_R - 0.6, z, P, 56) + k.ring(cx, cy, DIE_R - 2.4, z, P, 56);
  const check = k.onTop(
    [
      [-4.2, -0.4],
      [-1.2, 3],
      [4.6, -4],
    ].map(([du, dv]) => [cx + dv, cy - du]),
    z,
    P,
  );
  return { rings, check };
}

function mark(kind, index, paths, state) {
  const layer = (tone, opacity, extra) => `<g data-part="${kind}-${extra}" data-index="${index}" opacity="${fixed(opacity)}">${paths.map(([d, free]) => L(d, { tone, free })).join("")}</g>`;
  return layer("hi", state.on, "ink") + layer("lit", state.on * state.lit, "lit");
}

function prints(pose) {
  return PRINTS.map((spot, index) => {
    const { rings, check } = printPaths(spot);
    return mark(
      "print",
      index,
      [
        [rings, false],
        [check, true],
      ],
      pose.prints[index],
    );
  }).join("");
}

function ticks(pose) {
  return BOXES.map((v, index) => {
    const d = onSheet([
      [9.8, v + 4.4],
      [12.8, v + 7.6],
      [19.6, v - 2.4],
    ]);
    return mark("tick", index, [[d, true]], pose.ticks[index]);
  }).join("");
}

function lever() {
  const o = [37, 85, 7.4];
  const dir = G.unit3([-15, 0, 9]);
  const n = G.unit3([9, 0, 15]);
  const F = G.frameOf(o, n, [0, -1, 0], dir);
  const shape = k.roundedPlan({ x: -22, y: 0, w: 44, d: 19, r: 4 }, 5);
  const face = (u, v) => add(add(add(o, n, 0.6), [0, -1, 0], u), dir, v);
  const hole = k.roundedPlan({ x: -9, y: 11.5, w: 18, d: 4, r: 2 }, 4).map(([u, v]) => face(u, v));
  return S(G.prismOf(F, shape, -0.6, 0.6, P), { tone: "mid" }) + L(pathIn(hole), { tone: "lo" });
}

function clip(pose) {
  const out = [];
  const plate = { x: 31.5, y: 57, w: 9, d: 56, r: 2 };
  out.push(S(k.slabOf(plate, BOARD_H, 0.8, P, 3, 0.3), { tone: "mid" }));
  const rivets = [
    [34.2, 61],
    [34.2, 109],
  ];
  out.push(L(rivets.map(([x, y]) => k.ring(x, y, 1.2, BOARD_H + 0.8, P, 12)).join(""), { tone: "lo" }));
  out.push(lever());
  const ear = (y) => S(k.slabOf({ x: 33.6, y, w: 7, d: 2.4, r: 0.8 }, BOARD_H + 0.8, 5.6, P, 2, 0.3), { tone: "mid" });
  out.push(ear(56.4));
  const jaw = { x: 38, y: 60, w: 14.5, d: 50, r: 2 };
  out.push(S(k.slabOf(jaw, SHEET_Z + 0.1, JAW_Z - SHEET_Z - 0.1, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 51.5, y: 60, w: 3, d: 50, r: 1.4 }, SHEET_Z + 0.1, 1.9, P, 4, 0.3), { tone: "mid" }));
  out.push(L(k.planOutline(SLOT, JAW_Z, P, 4), { tone: "lo" }));
  const stops = Array.from({ length: STAGES }, (_, i) => STAGE_Y0 - i * STAGE_STEP);
  out.push(L(stops.map((y) => k.lineOnTop([SLOT.x + SLOT.w, y], [SLOT.x + SLOT.w + 2.4, y], JAW_Z, P)).join(""), { tone: "lo" }));
  out.push(S(G.disc(-26, 26, 2.2, G.frameAlong([37, 85, 5.6], [0, 1, 0]), P), { tone: "mid" }));
  out.push(ear(110.6));
  const knob = { x: 43.4, y: STAGE_Y0 - 2.6, w: 5.2, d: 5.2, r: 1.2 };
  const grip = k.lineOnTop([knob.x, STAGE_Y0], [knob.x + knob.w, STAGE_Y0], JAW_Z + 1.8, P);
  out.push(`<g data-part="marker" transform="${move(stageOffset(pose.stage))}">${S(k.slabOf(knob, JAW_Z, 1.8, P, 3, 0.3), { tone: "hi", inner: L(grip, { tone: "mid" }) })}</g>`);
  return out.join("");
}

function clipboard(pose) {
  const out = [halo(BOARD, 0, BOARD_H)];
  out.push(S(k.slabOf(BOARD, 0, BOARD_H, P, 6, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf({ x: SHEET.x - 0.6, y: SHEET.y - 0.8, w: SHEET.w + 0.4, d: SHEET.d + 0.6, r: 0.6 }, BOARD_H, 0.3, P, 2), { tone: "lo", crease: "none" }));
  out.push(S(k.slabOf(SHEET, BOARD_H + 0.3, SHEET_Z - BOARD_H - 0.3, P, 2), { tone: "hi", crease: "none" }));
  out.push(sheetText());
  out.push(prints(pose));
  out.push(ticks(pose));
  out.push(clip(pose));
  return out.join("");
}

function padLid() {
  const open = (135 * Math.PI) / 180;
  const up = [Math.cos(open), 0, Math.sin(open)];
  const out = [-Math.sin(open), 0, Math.cos(open)].map((value) => -value);
  const o = [PAD.x + 0.4, PAD.y + PAD.d / 2, 3.4];
  const F = G.frameOf(o, out, [0, -1, 0], up);
  const shape = k.roundedPlan({ x: -PAD.d / 2, y: 0, w: PAD.d, d: PAD.w, r: 4 }, 4);
  const face = (u, v) => add(add(add(o, out, 0.05), [0, -1, 0], u), up, v);
  const rim = k.roundedPlan({ x: -PAD.d / 2 + 3, y: 3, w: PAD.d - 6, d: PAD.w - 6, r: 2.4 }, 4).map(([u, v]) => face(u, v));
  return S(G.prismOf(F, shape, -1.8, 0, P), { tone: "mid" }) + L(pathIn(rim), { tone: "faint" });
}

function inkPad() {
  const out = [halo(PAD, 0, 4.4)];
  out.push(padLid());
  for (const y of [PAD.y + 9, PAD.y + PAD.d - 15]) out.push(S(k.slabOf({ x: PAD.x - 3.4, y, w: 4.4, d: 6, r: 1.2 }, 1.6, 3.6, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf(PAD, 0, 4.4, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(PAD, 1.6, P, 4), { tone: "faint" }) }));
  const felt = k.insetPlan(PAD, 3.4);
  out.push(S(k.slabOf(felt, 4.4, PAD_TOP - 4.4, P, 3), { tone: "lo", crease: "none" }));
  const dots = [];
  for (let x = felt.x + 3; x < felt.x + felt.w - 1; x += 4) for (let y = felt.y + 3; y < felt.y + felt.d - 1; y += 4) dots.push(at([x, y, PAD_TOP]));
  out.push(D(dots, { size: 0.35, tone: "faint" }));
  return out.join("");
}

function stamp(pose) {
  const [cx, cy] = STAMP_AT;
  const z = PAD_TOP;
  const out = [];
  out.push(S(k.cylinder(cx, cy, DIE_R, z, 1.6, P, 48), { tone: "lo" }));
  out.push(S(k.cylinder(cx, cy, 12.6, z + 1.6, 5.4, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(cx, cy, 12.6, z + 3.4, P, 32), { tone: "faint" }) }));
  const top = z + 7;
  out.push(L(k.ring(cx, cy, 9, top, P, 40) + k.ring(cx, cy, 7.4, top, P, 40), { tone: "faint" }));
  out.push(S(k.cylinder(cx, cy, 4.6, top, 2.6, P, 28), { tone: "mid", inner: L(k.knurl(cx, cy, 4.6, top, top + 2.6, 28, P, 0.5), { tone: "lo" }) }));
  out.push(S(k.cylinder(cx, cy, 3.4, top + 2.6, 7.8, P, 24), { tone: "hi", crease: "none" }));
  out.push(S(G.sphereOf([cx, cy, top + 16.5], 7, P), { tone: "hi" }));
  return `<g data-part="stamp" transform="${move(pose.stamp)}">${out.join("")}</g>`;
}

export default function figure() {
  const pose = poseAt(REST);
  const body = [
    railBack(),
    tickets(pose),
    railFront(),
    ...[1, 0].map((index) => laptop(LAPTOPS[index], index, pose.screens[index])),
    `<g transform="${move(CLIP_SHIFT)}">${clipboard(pose)}</g>`,
    `<g transform="${move(PAD_SHIFT)}">${inkPad()}${stamp(pose)}</g>`,
  ];
  return k.figureSvg({
    width: W,
    height: H,
    label:
      "A spec on a clipboard: a sheet with a title, a few lines on why, and a Done when list of two checkboxes. A round rubber stamp waits on its ink pad and presses an approval mark onto the sheet; only then do task tickets T1, T2 and T3 slide onto a kitchen order rail behind. Two laptops under the rail, one running Claude Code and one running Codex, each take the ticket above them and work it. As tasks finish the tickets come off the rail and the Done when boxes get ticked one by one. A marker on the clipboard's clip slides through five stops: draft, approved, working, delivered and accepted, and once every task is done and every box ticked, the stamp lands again to accept it.",
    body,
  });
}
