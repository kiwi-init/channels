import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import {
  BASE,
  DISPLAY,
  DISPLAY_H,
  DISPLAY_W,
  CARD,
  CARD_Z,
  FACE_X,
  FEET,
  FLOOR,
  FOLDER,
  FOLDER_T,
  H,
  HANDLE,
  LAPTOP,
  LID,
  LID_OUT,
  LID_UP,
  NICKS,
  P,
  PLATE,
  REST,
  SLIP,
  SLOPE,
  STAND,
  TAB,
  HOLDER,
  W,
  WEDGE,
  displayMatrix,
  lidCentre,
  lidOrigin,
  onSlope,
  poseAt,
  slipMatrix,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const at = (point) => k.iso(point, P);
const halo = (plan, z, h) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const pathIn = (points, closed = true) => k.pathOf(points.map(at), closed);
const fixed = (value) => Math.round(value * 1000) / 1000;
const move = (offset) => k.translateAlong(P, offset);

function folder() {
  const out = [halo(FOLDER, 0, FOLDER_T)];
  out.push(S(k.slabOf(FOLDER, 0, FOLDER_T, P, 4), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(TAB, 0, FOLDER_T, P, 4), { tone: "mid", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan({ ...TAB, d: TAB.d - 1.6 }, 1.8), FOLDER_T, P, 3), { tone: "faint" }));
  out.push(L(k.lineOnTop([TAB.x + 6, TAB.y + 4.6], [TAB.x + 26, TAB.y + 4.6], FOLDER_T, P), { tone: "lo", free: true }));
  const sheets = [
    { x: FOLDER.x + 1.4, y: FOLDER.y + 3, w: FOLDER.w + 1.2, d: FOLDER.d - 9, r: 0.4 },
    { x: FOLDER.x + 0.8, y: FOLDER.y + 6, w: FOLDER.w + 2.6, d: FOLDER.d - 14, r: 0.4 },
  ];
  sheets.forEach((plan, index) => out.push(S(k.slabOf(plan, FOLDER_T, 0.15 + index * 0.05, P, 2), { tone: "hi", crease: "none" })));
  const front = { ...FOLDER, w: FOLDER.w - 2.4, d: FOLDER.d - 2 };
  out.push(S(k.slabOf(front, FOLDER_T + 0.2, FOLDER_T - 0.2, P, 4), { tone: "mid", crease: "none" }));
  return out.join("");
}

function frontSlot(y, x0, x1, z0, z1, r) {
  return pathIn(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4).map(([x, z]) => [x, y, z]));
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

function screen(laptop) {
  const shape = k.pathOf(k.roundedPlan({ x: 0, y: 0, w: DISPLAY_W, d: DISPLAY_H, r: 2.4 }, 4), true);
  const bar = 9;
  const text = (x, y, size, tone, value) => `<text class="iso-face-text" data-tone="${tone}" x="${x}" y="${y}" font-size="${size}">${value}</text>`;
  const parts = [
    `<path class="iso-fill" d="${shape}"/>`,
    L(`M0 ${bar}H${DISPLAY_W}`, { tone: "faint" }),
    D(
      [0, 1, 2].map((i) => [5 + i * 4.4, bar / 2]),
      { size: 1.1, tone: "faint" },
    ),
    text(6, 20, 6.4, "lo", laptop.harness),
    text(6, 32, 8.4, "hi", "› kiwi join"),
    text(6, 43, 7, "mid", `joined as ${HANDLE}`),
    L("M6 52H88M6 59H62", { tone: "lo", free: true }),
    `<rect class="iso-face-text" data-tone="hi" x="6" y="63" width="4.4" height="6.4"/>`,
    L(shape, { tone: "lo" }),
  ];
  return `<g transform="${displayMatrix(laptop)}">${parts.join("")}</g>`;
}

function ports(laptop) {
  const y = laptop.y + BASE.d;
  const z0 = BASE.z + 2.2;
  const z1 = BASE.z + 4.4;
  const slots = [frontSlot(y, laptop.x + 14, laptop.x + 22, z0, z1, 1.1), frontSlot(y, laptop.x + 26, laptop.x + 34, z0, z1, 1.1), frontSlot(y, laptop.x + 42, laptop.x + 46, z0 + 0.2, z1 - 0.2, 1)];
  return L(slots.join(""), { tone: "lo" }) + D([at([laptop.x + 80, y, BASE.z + 3.3])], { size: 0.7, tone: "hi" });
}

function laptop(item) {
  const plan = { x: item.x, y: item.y, w: BASE.w, d: BASE.d, r: 6 };
  const top = BASE.z + BASE.h;
  const out = [halo(plan, FLOOR, BASE.h + FEET)];
  for (const [x, y] of byDepth(k.corners(plan, 10))) out.push(S(k.cylinder(x, y, 3, FLOOR, FEET, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf(plan, BASE.z, BASE.h, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, BASE.z + 2, P, 6), { tone: "faint" }) }));
  out.push(ports(item));
  out.push(L(k.planOutline({ x: item.x + 10.5, y: item.y + 9.6, w: 46, d: 120.8, r: 2 }, top, P, 4), { tone: "faint" }));
  out.push(keys(item));
  out.push(L(k.planOutline({ x: item.x + 62, y: item.y + 44, w: 26, d: 52, r: 3 }, top, P, 4), { tone: "lo" }));
  const hinge = G.frameAlong([item.x + 4, lidCentre(item), top + 2.2], [0, 1, 0]);
  out.push(S(G.disc(-58, 58, 2.2, hinge, P), { tone: "mid" }));
  const o = lidOrigin(item);
  const F = G.frameOf(o, LID_OUT, [0, -1, 0], LID_UP);
  const outline = k.roundedPlan({ x: -LID.w / 2, y: 0, w: LID.w, d: LID.h, r: 6 }, 6);
  out.push(S(G.prismOf(F, outline, -LID.t, 0, P), { tone: "mid" }));
  const camera = add(add(o, LID_UP, LID.h - DISPLAY.top / 2), LID_OUT, 0.05);
  out.push(L(G.circleOf(G.frameAlong(camera, LID_OUT), 0, 1.1, P, 16), { tone: "lo" }));
  out.push(screen(item));
  return out.join("");
}

function slopePrism(u0, u1, v0, v1, s0, s1, r = 0.6) {
  const F = G.frameOf(onSlope(0, 0, 0), SLOPE.out, [0, -1, 0], SLOPE.up);
  const shape = k.roundedPlan({ x: u0, y: v0, w: u1 - u0, d: v1 - v0, r }, 3);
  return G.prismOf(F, shape, s0, s1, P);
}

function ledge() {
  const F = G.frameOf(onSlope(4, 0, 0), [0, -1, 0], SLOPE.up, SLOPE.out);
  const bar = (v0, v1, s0, s1) =>
    G.prismOf(
      F,
      [
        [v0, s0],
        [v1, s0],
        [v1, s1],
        [v0, s1],
      ],
      0,
      STAND.d - 8,
      P,
    );
  return S(bar(1.4, 4.6, 0, 2.4), { tone: "mid" }) + S(bar(1.4, 7.6, 1.6, 2.4), { tone: "mid" });
}

function clips() {
  const out = [];
  for (const [u0, u1] of [
    [4.6, 12.6],
    [STAND.d - 12.6, STAND.d - 4.6],
  ]) {
    const inner = u0 < 10 ? [u0, SLIP.u0] : [SLIP.u0 + SLIP.w, u1];
    out.push(S(slopePrism(inner[0], inner[1], 4.6, SLIP.v0 + SLIP.h + 1.4, 0, 1.6, 0.4), { tone: "mid" }));
    out.push(S(slopePrism(u0, u1, 4.6, SLIP.v0 + SLIP.h + 1.4, 1.6, 2.4, 1), { tone: "mid" }));
    const mid = (u0 + u1) / 2;
    out.push(D([at(onSlope(mid, SLIP.v0 + SLIP.h - 3, 2.4)), at(onSlope(mid, 9, 2.4))], { size: 0.55, tone: "mid" }));
  }
  return out.join("");
}

function slip(index, name, state) {
  const body = S(slopePrism(SLIP.u0, SLIP.u0 + SLIP.w, SLIP.v0, SLIP.v0 + SLIP.h, SLIP.s, SLIP.s + SLIP.t, 0.4), { tone: "hi", lit: true });
  const words = `<g transform="${slipMatrix()}"><text class="iso-face-text" data-tone="hi" x="9" y="17.4" font-size="14">${name}</text></g>`;
  const offset = SLOPE.up.map((value) => value * state.v);
  return `<g data-part="slip" data-index="${index}" transform="${move(offset)}" opacity="${fixed(state.on)}">${body}${words}</g>`;
}

function plate() {
  const plan = { x: FACE_X, y: PLATE.y0, w: 0.8, d: PLATE.y1 - PLATE.y0, r: 0.5 };
  const out = [S(k.slabOf(plan, PLATE.z0, PLATE.z1 - PLATE.z0, P, 2, 0.3), { tone: "hi" })];
  const face = k.sideMatrix([FACE_X + 0.8, PLATE.y1], PLATE.z1, P, "right");
  const width = PLATE.y1 - PLATE.y0;
  const height = PLATE.z1 - PLATE.z0;
  out.push(`<g transform="${face}"><text class="iso-face-text" data-tone="hi" x="${width / 2}" y="${height / 2 + 2.5}" font-size="7.2" text-anchor="middle">${HANDLE}</text></g>`);
  const screws = [3.6, width - 3.6].map((u) => [FACE_X + 0.8, PLATE.y1 - u, PLATE.z1 - height / 2]);
  out.push(L(screws.map((point) => k.sideRing(point, 1.3, "x", P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(at), { size: 0.5, tone: "mid" }));
  return out.join("");
}

function stand(pose) {
  const out = [halo({ x: STAND.x, y: STAND.y, w: WEDGE[1][0], d: STAND.d, r: 2 }, 0, 4)];
  const feet = byDepth([
    [STAND.x + 5, STAND.y + 8],
    [STAND.x + 25, STAND.y + 8],
    [STAND.x + 5, STAND.y + STAND.d - 8],
    [STAND.x + 25, STAND.y + STAND.d - 8],
  ]);
  for (const [x, y] of feet) out.push(S(k.cylinder(x, y, 2.6, 0, STAND.feet, P, 16), { tone: "lo" }));
  const end = STAND.y + STAND.d;
  const F = G.frameOf([STAND.x, end, STAND.feet], [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  const profile = WEDGE.map(([x, z]) => [x, z]);
  const inset = [
    [2.4, 2.4],
    [27.6, 2.4],
    [27.6, 15.2],
    [7.4, 43.2],
    [2.4, 43.2],
  ].map(([x, z]) => [STAND.x + x, end, STAND.feet + z]);
  out.push(S(G.prismOf(F, profile, 0, STAND.d, P), { tone: "mid", inner: L(pathIn(inset), { tone: "faint" }) }));
  out.push(plate());
  pose.slips.forEach((state, index) => out.push(slip(index, NICKS[index], state)));
  out.push(ledge());
  out.push(clips());
  return out.join("");
}

function holder() {
  const { x, y, r, h, top, coil } = HOLDER;
  const out = [halo({ x: x - r, y: y - r, w: r * 2, d: r * 2, r }, 0, h)];
  out.push(S(k.cylinder(x, y, r, 0, h, P, 48, 0.6), { tone: "lo", inner: L(k.sideArc(x, y, r, 1.6, P, 32), { tone: "faint" }) }));
  out.push(L(k.ring(x, y, r - 2.6, h, P, 40), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 2.2, h, 1.8, P, 20, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 0.7, h + 1.8, top - coil - h - 1.8, P, 12), { tone: "mid", crease: "none" }));
  return out.join("");
}

function spiral(side) {
  const { x, y, top, coil } = HOLDER;
  const turns = k.coil(y - 6, y + 6, [x, top], coil, 6, "y", P, 20);
  if (side === "back") return L(turns.back, { tone: "lo" });
  const ends = [at([x + coil, y - 6, top]), at([x + coil, y + 6, top])];
  return L(turns.front, { tone: "hi" }) + D(ends, { size: 0.6, tone: "hi" });
}

function card() {
  const { x, y, w, h, t } = CARD;
  const out = [S(k.slabOf({ x, y, w: t, d: w, r: 0.3 }, CARD_Z, h, P, 2), { tone: "hi", crease: "none" })];
  const face = k.sideMatrix([x + t, y + w], CARD_Z + h, P, "right");
  const rows = [8, 15.5, 23, 30.5, 38];
  const values = ["arm64", "claude", "opus", "docker", "main"];
  const words = values.map((value, i) => `<text class="iso-face-text" data-tone="mid" x="11" y="${rows[i] + 5.6}" font-size="4.8">${value}</text>`).join("");
  const rules = [...rows, rows[rows.length - 1] + 7.5].map((v) => `M0 ${v}H${w}`).join("");
  const labels = rows.map((v) => `M3.4 ${v + 4}H8`).join("");
  const head = `M3.4 4.2H${w * 0.42}`;
  out.push(`<g transform="${face}">${L(rules, { tone: "faint" })}${L(labels + head, { tone: "lo", free: true })}${words}</g>`);
  return out.join("");
}

export default function figure() {
  const pose = poseAt(REST);
  return k.figureSvg({
    width: W,
    height: H,
    label:
      "An agent's seat. A laptop running Claude Code sits on a manila folder, the folder it joined from; its terminal reads kiwi join, joined as @gentle-otter. In front of it stands a desk nameplate: the handle @gentle-otter is engraved on a metal plate screwed to the stand and never changes, while the nickname is a paper slip in a holder above it. The slip reads claude, what the agent runs in, until the owner slides it out and puts in one that reads atlas; the engraved handle stays as it was. A card standing in a spiral memo holder behind the laptop lists what the agent runs on: arm64, claude, opus, docker and main.",
    body: [holder(), spiral("back"), card(), spiral("front"), folder(), laptop(LAPTOP), stand(pose)],
  });
}
