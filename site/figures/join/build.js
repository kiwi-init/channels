import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import {
  WIDTH,
  HEIGHT,
  CODE,
  ROOM,
  T,
  MON,
  GLASS,
  BOX,
  BOX_Z,
  BASE,
  BASE_Z,
  HINGE,
  LID_UP,
  LID_OUT,
  LID,
  DISPLAY,
  CABLE_R,
  PORT_A,
  PORT_M,
  PORT_B,
  PORT_L,
  ROUTE_A,
  ROUTE_B,
  P,
  planeMatrix,
  lidPoint,
  SCREEN_T,
  SCREEN_L,
  REEL,
  L as LAP,
} from "./model.js";

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (u0, v0, u1, v1, r = 0, steps = 5) => k.pathOf(k.roundedPlan({ x: u0, y: v0, w: u1 - u0, d: v1 - v0, r }, steps), true);
const onPlane = (matrix, inner) => `<g transform="${matrix}">${inner}</g>`;
const text = (x, y, value, size, cls, extra = "") => `<text class="${cls}" x="${x}" y="${y}" font-size="${size}"${extra}>${value}</text>`;

let ids = 0;
const nextId = () => `jn-${ids++}`;

const STYLE = `<style>
[data-figure="join"] .jn-glass{fill:var(--anatomy-shade-0)}
[data-figure="join"] .jn-card{fill:var(--anatomy-top)}
[data-figure="join"] .jn-pick{fill:var(--anatomy-shade-3)}
[data-figure="join"] .jn-socket{fill:var(--anatomy-shade-0)}
[data-figure="join"] .jn-t{font-family:var(--anatomy-mono);fill:var(--anatomy-mid)}
[data-figure="join"] .jn-t[data-tone="hi"]{fill:var(--anatomy-hi)}
[data-figure="join"] .jn-t[data-tone="lo"]{fill:var(--anatomy-lo)}
[data-figure="join"] .jn-t[data-tone="faint"]{fill:var(--anatomy-faint)}
[data-figure="join"] .jn-digit{font-family:var(--anatomy-mono);fill:var(--anatomy-hi);transition:fill .45s var(--anatomy-ease)}
[data-figure="join"] [data-lit] .jn-digit{fill:var(--anatomy-lit)}
[data-figure="join"] .jn-btn{fill:var(--anatomy-hi);transition:fill .25s var(--anatomy-ease)}
[data-figure="join"] [data-lit] .jn-btn{fill:var(--anatomy-lit)}
[data-figure="join"] .jn-lip{fill:var(--anatomy-lo)}
[data-figure="join"] .jn-btn-t{font-family:var(--anatomy-mono);fill:var(--anatomy-shade-0)}
[data-figure="join"] .jn-ghost{fill:none;stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="join"] .jn-cursor{fill:var(--anatomy-hi);stroke:var(--anatomy-shade-0);stroke-width:.5px;stroke-linejoin:round}
[data-figure="join"] .jn-led{fill:var(--anatomy-lo)}
[data-figure="join"] .jn-led[data-on]{fill:var(--anatomy-hi)}
[data-figure="join"] .jn-lock{fill:var(--anatomy-lit)}
[data-figure="join"] .jn-joined[data-lit] .jn-t{fill:var(--anatomy-lit)}
[data-figure="join"] [data-done] .jn-digit{fill:var(--anatomy-lo)}
</style>`;

function feet(plan, inset, r, h) {
  return byDepth(k.corners(plan, inset))
    .map(([x, y]) => S(k.cylinder(x, y, r, 0, h, P, 20), { tone: "lo" }))
    .join("");
}

function relay() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOX, 0, 12, P)}"/>`];
  out.push(feet(BOX, 9, 4.2, BOX_Z[0]));
  const [z0, z1] = BOX_Z;
  const seam = k.sideSeam(BOX, z0 + 7, P, 6);
  out.push(S(k.slabOf(BOX, z0, z1 - z0, P, 6, 1.2), { tone: "hi", inner: Ln(seam, { tone: "faint" }) }));
  const lid = k.insetPlan(BOX, 4);
  out.push(Ln(k.planOutline(lid, z1, P, 5), { tone: "lo" }));
  const screws = k.corners(BOX, 8);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 1.9, z1, P, 14)).join(""), { tone: "lo" }));
  out.push(
    D(
      screws.map(([x, y]) => at([x, y, z1])),
      { size: 0.5 },
    ),
  );
  const slots = [];
  for (let i = 0; i < 9; i++) slots.push(k.planOutline({ x: BOX.x + 24 + i * 5, y: BOX.y + 14, w: 2, d: 30, r: 1 }, z1, P, 3));
  out.push(Ln(slots.join(""), { tone: "faint" }));
  const plate = { x: BOX.x + 22, y: BOX.y + 50, w: 34, d: 9, r: 1.2 };
  out.push(S(k.slabOf(plate, z1, 0.7, P, 3), { tone: "lo", crease: "none" }));
  out.push(Ln(k.planOutline(k.insetPlan(plate, 1.4), z1 + 0.7, P, 3), { tone: "faint" }));
  out.push(D([at([plate.x + 3.4, plate.y + plate.d / 2, z1 + 0.7]), at([plate.x + plate.w - 3.4, plate.y + plate.d / 2, z1 + 0.7])], { size: 0.45 }));
  out.push(k.faceTextSvg(k.topMatrix([plate.x + 7, plate.y + 6.6], z1 + 0.7, P), "relay", { size: 5, tone: "mid" }));

  const left = planeMatrix([BOX.x, BOX.y + BOX.d, z1], [1, 0, 0], [0, 0, -1]);
  const portU = PORT_A.x - BOX.x;
  const portV = z1 - PORT_A.z;
  const leftFace = [
    `<path class="jn-glass" d="${rect(38, 12, 84, 25, 1.6)}"/>`,
    Ln(rect(38, 12, 84, 25, 1.6), { tone: "lo" }),
    `<g data-part="cipher">${text(41.5, 20.6, "7f c2 9a e1", 5.4, "jn-t", ' data-tone="lo"')}</g>`,
    Ln(rect(portU - 5.5, portV - 5, portU + 5.5, portV + 5, 1), { tone: "lo" }),
    `<path class="jn-socket" d="${rect(portU - 4.3, portV - 3.8, portU + 4.3, portV + 3.8, 0.8)}"/>`,
    ...[0, 1, 2].map((i) => `<circle class="jn-led"${i === 0 ? " data-on" : ""} data-led="${i}" cx="${44 + i * 7}" cy="34" r="1.5"/>`),
    Ln(rect(41.5, 31.5, 46.5, 36.5, 2.5) + rect(48.5, 31.5, 53.5, 36.5, 2.5) + rect(55.5, 31.5, 60.5, 36.5, 2.5), { tone: "faint" }),
  ];
  out.push(onPlane(left, leftFace.join("")));
  const right = planeMatrix([BOX.x + BOX.w, BOX.y + BOX.d, z1], [0, -1, 0], [0, 0, -1]);
  const portRU = BOX.y + BOX.d - PORT_B.y;
  const vents = [];
  for (let i = 0; i < 6; i++) vents.push(rect(8 + i * 4.6, 10, 10 + i * 4.6, 40, 1, 3));
  const rightFace = [
    Ln(vents.join(""), { tone: "faint" }),
    Ln(rect(portRU - 5.5, portV - 5, portRU + 5.5, portV + 5, 1), { tone: "lo" }),
    `<path class="jn-socket" d="${rect(portRU - 4.3, portV - 3.8, portRU + 4.3, portV + 3.8, 0.8)}"/>`,
    Ln(`M54.1 12.4a3.3 3.3 0 1 0 3.8 0`, { tone: "mid", free: true }),
    Ln(`M56 10.6V14.6`, { tone: "mid", free: true }),
  ];
  out.push(onPlane(right, rightFace.join("")));
  return out.join("");
}

function plugOnY(port, sign) {
  const out = [];
  const body = { x: port.x - 4.2, y: sign > 0 ? port.y : port.y - 9, w: 8.4, d: 9, r: 0.8 };
  const boot = { x: port.x - 3, y: sign > 0 ? port.y + 9 : port.y - 14, w: 6, d: 5, r: 1.4 };
  const pieces = [
    [body, port.z - 3.6, 7.2, "mid"],
    [boot, port.z - 2.8, 5.6, "lo"],
  ];
  const ordered = sign > 0 ? pieces : [...pieces].reverse();
  for (const [plan, z, h, tone] of ordered) out.push(S(k.slabOf(plan, z, h, P, 2, 0.4), { tone }));
  out.push(
    Ln(k.lineOnTop([port.x - 2.4, body.y + 2], [port.x - 2.4, body.y + 7], port.z + 3.6, P) + k.lineOnTop([port.x + 2.4, body.y + 2], [port.x + 2.4, body.y + 7], port.z + 3.6, P), { tone: "faint" }),
  );
  return out.join("");
}

function plugOnX(port, sign, thin = false) {
  const out = [];
  const h = thin ? 3.6 : 7.2;
  const body = { x: sign > 0 ? port.x : port.x - 9, y: port.y - 4.2, w: 9, d: 8.4, r: thin ? 1.6 : 0.8 };
  const boot = { x: sign > 0 ? port.x + 9 : port.x - 14, y: port.y - 3, w: 5, d: 6, r: 1.4 };
  const pieces = [
    [body, port.z - h / 2, h, "mid"],
    [boot, port.z - 2.8, 5.6, "lo"],
  ];
  const ordered = sign > 0 ? pieces : [...pieces].reverse();
  for (const [plan, z, hh, tone] of ordered) out.push(S(k.slabOf(plan, z, hh, P, 3, 0.4), { tone }));
  if (!thin)
    out.push(
      Ln(k.lineOnTop([body.x + 2, port.y - 2.4], [body.x + 7, port.y - 2.4], port.z + h / 2, P) + k.lineOnTop([body.x + 2, port.y + 2.4], [body.x + 7, port.y + 2.4], port.z + h / 2, P), {
        tone: "faint",
      }),
    );
  return out.join("");
}

function cable(route) {
  return tubePieces(route, CABLE_R, P, { maxLength: 400 })
    .map((piece) => tubeSvg(piece, { tone: "mid" }))
    .join("");
}

function cables() {
  return [plugOnY(PORT_A, 1), cable(ROUTE_A), plugOnY(PORT_M, -1), plugOnX(PORT_B, 1), cable(ROUTE_B), plugOnX(PORT_L, -1, true)].join("");
}

function packet(name) {
  const o = [0, 0, 0];
  const box = { x: -5.5, y: -5.5, w: 11, d: 11, r: 1.4 };
  const solid = S(k.slabOf(box, -4, 8, P, 3, 0.5), { tone: "hi", lit: true });
  const band = Ln(k.lineOnTop([-5.5, 0], [5.5, 0], 4, P) + k.lineOnTop([0, -5.5], [0, 5.5], 4, P), { tone: "lit" });
  const lock = planeMatrix([5.5, 3.2, 1.5], [0, -1, 0], [0, 0, -1]);
  const padlock = onPlane(lock, `<path class="iso-line" data-tone="lit" d="M1.3 0.8V-1.4a1.6 1.6 0 0 1 3.2 0V0.8"/><path class="jn-lock" d="${rect(0.4, 0, 5.4, 3.8, 0.6)}"/>`);
  const [ox, oy] = at(o);
  return `<g data-packet="${name}" opacity="0" transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)})"><g transform="translate(${(-ox).toFixed(1)} ${(-oy).toFixed(1)})">${solid}${band}${padlock}</g></g>`;
}

function terminal() {
  const out = [];
  const foot = { x: T.x - 44, y: T.y - 34, w: 54, d: 68, r: 9 };
  const kb = { x: T.x + 24, y: T.y - 64, w: 48, d: 128, r: 4 };
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 8, P)}"/>`);
  out.push(S(k.slabOf(foot, 0, 3.6, P, 8, 1), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(foot, 4), 3.6, P, 8), { tone: "faint" }));
  const neck = { x: T.x - 26, y: T.y - 10, w: 9, d: 20, r: 2 };
  out.push(S(k.slabOf(neck, 3.6, 82, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: T.x - 30, y: T.y - 12, w: 14, d: 24, r: 3 }, 3.6, 3, P, 4), { tone: "lo" }));
  const hump = { x: T.x - 17, y: T.y - 52, w: 11, d: 104, r: 6 };
  out.push(S(k.slabOf(hump, 54, 66, P, 8, 0.8), { tone: "mid" }));
  const body = { x: MON.x0, y: MON.y0, w: MON.x1 - MON.x0, d: MON.y1 - MON.y0, r: 3.5 };
  out.push(S(k.slabOf(body, MON.z0, MON.z1 - MON.z0, P, 6, 1.2), { tone: "hi" }));
  const vents = [];
  for (let i = 0; i < 12; i++) vents.push(k.planOutline({ x: MON.x0 + 3, y: T.y - 40 + i * 7, w: 6, d: 2.4, r: 1.2 }, MON.z1, P, 3));
  out.push(Ln(vents.join(""), { tone: "faint" }));
  out.push(screenT());
  const front = planeMatrix([MON.x1, MON.y1, MON.z0], [0, -1, 0], [0, 0, -1]);
  out.push(
    onPlane(
      front,
      D([[80, -6.5]], { size: 0.9, tone: "hi" }) +
        `<circle class="jn-socket" cx="80" cy="${-(MON.z1 - MON.z0) + 3.5}" r="1.3"/>` +
        Ln(`M78.4 ${-(MON.z1 - MON.z0) + 3.5}a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z`, { tone: "lo" }),
    ),
  );
  const end = planeMatrix([MON.x0, MON.y1, MON.z0 + 24], [1, 0, 0], [0, 0, -1]);
  out.push(onPlane(end, Ln(rect(3.6, 0, 8.4, 2.4, 1.2, 3) + rect(3.6, 5, 8.4, 7.4, 1.2, 3) + `M6 11.2a1.2 1.2 0 1 0 0.01 0Z`, { tone: "lo" })));
  out.push(keyboard(kb));
  return out.join("");
}

function screenT() {
  const w = GLASS.y1 - GLASS.y0;
  const h = GLASS.z1 - GLASS.z0;
  const clip = nextId();
  const r = REEL.term;
  const inner = [
    `<clipPath id="${clip}"><path d="${rect(0, 0, w, h, 2)}"/></clipPath>`,
    `<path class="jn-glass" d="${rect(0, 0, w, h, 2)}"/>`,
    `<g clip-path="url(#${clip})">`,
    text(7, 13, "$ kiwi join mc2-7Fq…", 7.4, "jn-t", ' data-tone="mid"'),
    `<g data-part="ask-t">${text(7, 27, "verification code", 6.2, "jn-t", ' data-tone="lo"')}</g>`,
    reels("t", r, 0, w),
    `<g data-part="joined" class="jn-joined" opacity="0">${text(7, 81, `joined "${ROOM}"`, 11, "jn-t", ' data-tone="hi"')}</g>`,
    `</g>`,
    Ln(rect(0, 0, w, h, 2), { tone: "lo" }),
  ];
  return onPlane(SCREEN_T, inner.join(""));
}

function reels(side, r, u0, u1) {
  const cells = [];
  const clips = [];
  for (let i = 0; i < 6; i++) {
    const x = r.x + i * r.pitch + (i >= 3 ? r.gap : 0);
    const id = nextId();
    clips.push(`<clipPath id="${id}"><rect x="${x - 1}" y="${(r.y - r.size * 0.86).toFixed(2)}" width="${(r.pitch + 1).toFixed(2)}" height="${(r.size * 1.06).toFixed(2)}"/></clipPath>`);
    const glyphs = [];
    for (let n = 0; n <= 10; n++) glyphs.push(text(x, (r.y + n * r.size * 1.1).toFixed(2), String(n % 10), r.size, "jn-digit"));
    const target = Number(CODE[i]);
    cells.push(`<g clip-path="url(#${id})"><g data-reel="${side}${i}" transform="translate(0 ${(-target * r.size * 1.1).toFixed(2)})">${glyphs.join("")}</g></g>`);
  }
  const dashX = r.x + 3 * r.pitch;
  const dash = text(dashX, r.y, "-", r.size, "jn-digit");
  return `<g data-code="${side}" data-lit data-u="${u0} ${u1}">${clips.join("")}${cells.join("")}<g data-part="dash">${dash}</g></g>`;
}

function keyboard(kb) {
  const out = [`<path class="iso-halo" d="${k.haloOf(kb, 0, 3, P)}"/>`];
  out.push(feet(kb, 7, 2.6, 1));
  out.push(S(k.slabOf(kb, 1, 4.4, P, 6, 0.8), { tone: "mid" }));
  const top = 5.4;
  const well = { x: kb.x + 3, y: kb.y + 3, w: kb.w - 6, d: kb.d - 6, r: 2 };
  out.push(Ln(k.planOutline(well, top, P, 4), { tone: "lo" }));
  const pitch = 9.3;
  const rowsU = [Array(13).fill(1), Array(13).fill(1), Array(13).fill(1), [1.5, 1.25, 6.5, 1.25, 1.5, 1]];
  const keys = [];
  rowsU.forEach((row, i) => {
    let y = kb.y + 4.4;
    for (const width of row) {
      const plan = { x: kb.x + 4.6 + i * 10, y: y + 0.6, w: 8.6, d: width * pitch - 1.2, r: 1.3 };
      keys.push({ plan, depth: k.depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, 0], P) });
      y += width * pitch;
    }
  });
  keys.sort((a, b) => a.depth - b.depth);
  for (const { plan } of keys) out.push(S(k.slabOf(plan, top, 2.2, P, 3, 0.35), { tone: "mid", inner: "" }) + Ln(k.planOutline(k.insetPlan(plan, 1.5), top + 2.2, P, 3), { tone: "faint" }));
  return out.join("");
}

function laptop() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, 0, 12, P)}"/>`];
  out.push(feet(BASE, 12, 3.6, BASE_Z[0]));
  const [z0, z1] = BASE_Z;
  out.push(S(k.slabOf(BASE, z0, z1 - z0, P, 8, 1.2), { tone: "hi", inner: Ln(k.sideSeam(BASE, z0 + 2.4, P, 8), { tone: "faint" }) }));
  const scoop = k.pathOf(Array.from({ length: 17 }, (_, i) => at([LAP.x - 14 + i * 1.75, BASE.y + BASE.d, z1 - 0.2 - Math.sin((i / 16) * Math.PI) * 2.4])));
  out.push(Ln(scoop, { tone: "lo" }));
  const well = { x: LAP.x - 62, y: BASE.y + 9, w: 124, d: 42, r: 2.5 };
  out.push(S(k.slabOf(well, z1 - 0.6, 0.6, P, 4), { tone: "lo", flat: true, crease: "none" }));
  out.push(Ln(k.planOutline(well, z1, P, 4), { tone: "lo" }));
  const rowsU = [Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), [1.5, 1.25, 6.5, 1.25, 1.5]];
  const keys = [];
  rowsU.forEach((row, j) => {
    let x = well.x + 2;
    for (const width of row) {
      const plan = { x: x + 0.7, y: well.y + 1.6 + j * 7.8, w: width * 10 - 1.4, d: 6.4, r: 1 };
      keys.push({ plan, depth: k.depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, 0], P) });
      x += width * 10;
    }
  });
  keys.sort((a, b) => a.depth - b.depth);
  for (const { plan } of keys) out.push(S(k.slabOf(plan, z1 - 0.6, 1.3, P, 2, 0.3), { tone: "mid" }));
  const pad = { x: LAP.x - 27, y: BASE.y + 57, w: 54, d: 33, r: 3 };
  out.push(Ln(k.planOutline(pad, z1, P, 5), { tone: "lo" }));
  out.push(Ln(k.planOutline(k.insetPlan(pad, 1.2), z1, P, 5), { tone: "faint" }));
  const grilles = [LAP.x - 68.5, LAP.x + 64.2].map((x) => D(k.dotGrid(x, BASE.y + 11, 3, 12, 1.5, z1, P), { size: 0.35, tone: "lo" }));
  out.push(grilles.join(""));
  const side = planeMatrix([BASE.x + BASE.w, BASE.y + BASE.d, z1], [0, -1, 0], [0, 0, -1]);
  out.push(onPlane(side, Ln(rect(22, 3.2, 31, 6, 1.4) + rect(35, 3.2, 44, 6, 1.4) + rect(50, 3.4, 53, 5.8, 1.2), { tone: "lo" })));
  const hinge = G.frameAlong([LAP.x, HINGE[1], HINGE[2]], [1, 0, 0]);
  out.push(S(G.disc(-60, 60, 2.4, hinge, P), { tone: "mid" }));
  const F = G.frameOf(HINGE, LID_OUT, [1, 0, 0], LID_UP);
  const outline = k.roundedPlan({ x: LID.u0, y: LID.v0, w: LID.u1 - LID.u0, d: LID.v1 - LID.v0, r: LID.r }, 6);
  out.push(S(G.prismOf(F, outline, -LID.t, 0, P), { tone: "hi" }));
  out.push(screenL());
  return out.join("");
}

function history() {
  const rows = [
    [15, 78, 64],
    [29, 92, 70],
    [43, 70, 0],
  ];
  return rows.map(([v, a, b]) => `<circle class="jn-led" cx="37" cy="${v}" r="2.4"/>${Ln(`M42 ${v - 1.2}H${a}${b ? `M42 ${v + 2.6}H${b}` : ""}`, { tone: "lo", free: true })}`).join("");
}

function screenL() {
  const w = DISPLAY.u1 - DISPLAY.u0;
  const h = DISPLAY.v1 - DISPLAY.v0;
  const clip = nextId();
  const r = REEL.app;
  const card = { u0: 37, v0: 12, u1: 122, v1: 73 };
  const side = [];
  side.push(`<path class="jn-pick" d="${rect(2.5, 13, 28, 19.5, 1.5)}"/>`);
  for (let i = 0; i < 3; i++) {
    const v = 16.2 + i * 7.5;
    side.push(Ln(rect(5, v - 1.9, 8.8, v + 1.9, 0.9), { tone: i === 0 ? "mid" : "lo" }));
    side.push(Ln(`M11.5 ${v}H${[22, 18, 20][i]}`, { tone: i === 0 ? "hi" : "lo", free: true }));
  }
  side.push(Ln(`M0 39.5H30.5`, { tone: "faint" }));
  const members = [
    [45, 19],
    [51.5, 15],
    [58, 21],
  ];
  for (const [v, len] of members) {
    side.push(`<circle class="jn-led" cx="6.4" cy="${v}" r="1.9"/>`);
    side.push(Ln(`M10.5 ${v}H${len}`, { tone: "lo", free: true }));
  }
  const fresh = `<g data-part="member" opacity="0"><circle class="jn-led" data-on cx="6.4" cy="64.5" r="1.9"/>${text(10.5, 66.6, "claude", 5.4, "jn-t", ' data-tone="hi"')}</g>`;
  const cardSvg = [
    `<path class="jn-card" d="${rect(card.u0, card.v0, card.u1, card.v1, 3)}"/>`,
    Ln(rect(card.u0, card.v0, card.u1, card.v1, 3), { tone: "faint" }),
    `<circle class="jn-led" data-on cx="${card.u0 + 8}" cy="${card.v0 + 9}" r="4.2"/>`,
    Ln(`M${card.u0 + 6.2} ${card.v0 + 7.2}l1.8 1.8l-1.8 1.8M${card.u0 + 8.6} ${card.v0 + 10.8}h2`, { tone: "faint", free: true }),
    text(card.u0 + 15.5, card.v0 + 8.2, "claude", 6.2, "jn-t", ' data-tone="hi"'),
    Ln(`M${card.u0 + 15.5} ${card.v0 + 12.6}H${card.u0 + 52}`, { tone: "lo", free: true }),
    reels("a", r, card.u0, card.u1),
    `<g data-part="letin"><path class="jn-lip" d="${rect(card.u0 + 8, 59.4, card.u0 + 40, 69.4, 2)}"/><g data-part="btn"><path class="jn-btn" d="${rect(card.u0 + 8, 58, card.u0 + 40, 68, 2)}"/>${text(card.u0 + 24, 65.1, "Let in", 6, "jn-btn-t", ' text-anchor="middle"')}</g>`,
    `<path class="jn-ghost" d="${rect(card.u0 + 44, 58, card.u0 + 77, 68, 2)}"/>${text(card.u0 + 60.5, 64.9, "Turn away", 5, "jn-t", ' data-tone="mid" text-anchor="middle"')}</g>`,
  ];
  const inner = [
    `<clipPath id="${clip}"><path d="${rect(0, 0, w, h, 1.2)}"/></clipPath>`,
    `<path class="jn-glass" d="${rect(0, 0, w, h, 1.2)}"/>`,
    `<g clip-path="url(#${clip})">`,
    Ln(`M0 7H${w}M30.5 7V${h}`, { tone: "faint" }),
    `<circle class="jn-led" cx="4" cy="3.5" r="1.1"/><circle class="jn-led" cx="8" cy="3.5" r="1.1"/><circle class="jn-led" cx="12" cy="3.5" r="1.1"/>`,
    side.join(""),
    fresh,
    history(),
    `<g data-part="notice" opacity="0"><circle class="jn-led" data-on cx="37" cy="58" r="2.4"/>${text(42, 60.2, "claude joined", 6, "jn-t", ' data-tone="hi"')}</g>`,
    `<g data-part="card">${cardSvg.join("")}</g>`,
    `<g data-part="cursor" transform="translate(66 68)"><path class="jn-cursor" d="M0 0V8.6L2.2 6.6L3.7 10L5.3 9.3L3.8 6H6.9Z"/></g>`,
    `</g>`,
    Ln(rect(0, 0, w, h, 1.2), { tone: "lo" }),
  ];
  const cam = onPlane(planeMatrix(lidPoint(0, DISPLAY.v1 + 2.6), [1, 0, 0], [0, -LID_UP[1], -LID_UP[2]]), `<circle class="jn-socket" cx="0" cy="0" r="1"/>`);
  return onPlane(SCREEN_L, inner.join("")) + cam;
}

export default function figure() {
  ids = 0;
  const body = [STYLE, relay(), cables(), packet("ask"), packet("keys"), terminal(), laptop()];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "An agent's terminal on the left, a small relay box at the back, and the channel owner's laptop on the right, joined by cables through the relay. The terminal shows kiwi join with a verification code, 482-913. The laptop runs the Channels app with a card for the waiting agent showing the same 482-913 and a Let in button. When the owner presses Let in, a sealed packet carrying the channel's keys travels back through the relay to the terminal, which then shows that it joined.",
    body,
  });
}
