import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import {
  WIDTH,
  HEIGHT,
  DIGITS,
  T,
  MON,
  GLASS,
  KB,
  PC,
  PC_Z,
  SLOT,
  LABEL_AT,
  TRAY,
  TRAY_Z,
  STAMP_REST,
  BASE,
  BASE_Z,
  HINGE,
  LID_UP,
  LID_OUT,
  LID,
  DISPLAY,
  CARD,
  CARD_SLOT,
  CARD_TOP,
  P,
  planeMatrix,
  lidPoint,
  SCREEN_T,
  SCREEN_L,
  BOXES,
  boxU,
  ROWS,
  cardPaths,
  cardFace,
  CURSOR_REST,
  L as LAP,
} from "./model.js";

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (u0, v0, u1, v1, r = 0, steps = 5) => k.pathOf(k.roundedPlan({ x: u0, y: v0, w: u1 - u0, d: v1 - v0, r }, steps), true);
const onPlane = (matrix, inner, extra = "") => `<g transform="${matrix}"${extra}>${inner}</g>`;
const text = (x, y, value, size, cls, extra = "") => `<text class="${cls}" x="${x}" y="${y}" font-size="${size}"${extra}>${value}</text>`;

let ids = 0;
const nextId = () => `dv-${ids++}`;

const STYLE = `<style>
[data-figure="devices"] .dv-glass{fill:var(--anatomy-shade-0)}
[data-figure="devices"] .dv-socket{fill:var(--anatomy-shade-0)}
[data-figure="devices"] .dv-t{font-family:var(--anatomy-mono);fill:var(--anatomy-mid)}
[data-figure="devices"] .dv-t[data-tone="hi"]{fill:var(--anatomy-hi)}
[data-figure="devices"] .dv-t[data-tone="lo"]{fill:var(--anatomy-lo)}
[data-figure="devices"] [data-lit] > .dv-t{fill:var(--anatomy-lit)}
[data-figure="devices"] .dv-t[data-lit]{fill:var(--anatomy-lit)}
[data-figure="devices"] .dv-dot{fill:var(--anatomy-lo)}
[data-figure="devices"] .dv-dot[data-on]{fill:var(--anatomy-hi)}
[data-figure="devices"] .dv-box{fill:var(--anatomy-shade-2);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="devices"] .dv-box[data-on]{stroke:var(--anatomy-hi)}
[data-figure="devices"] .dv-cursor{fill:var(--anatomy-hi);stroke:var(--anatomy-shade-0);stroke-width:.5px;stroke-linejoin:round}
[data-figure="devices"] .dv-ink{fill:none;stroke:var(--anatomy-lit);stroke-width:var(--anatomy-weight)}
[data-figure="devices"] .dv-led{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="devices"] .dv-led[data-on]{fill:var(--anatomy-hi);stroke:var(--anatomy-hi)}
</style>`;

function feet(plan, inset, r, h) {
  return byDepth(k.corners(plan, inset))
    .map(([x, y]) => S(k.cylinder(x, y, r, 0, h, P, 20), { tone: "lo" }))
    .join("");
}

function terminal() {
  const out = [];
  const foot = { x: T.x - 44, y: T.y - 34, w: 54, d: 68, r: 9 };
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 8, P)}"/>`);
  out.push(S(k.slabOf(foot, 0, 3.6, P, 8, 1), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(foot, 4), 3.6, P, 8), { tone: "faint" }));
  out.push(S(k.slabOf({ x: T.x - 26, y: T.y - 10, w: 9, d: 20, r: 2 }, 3.6, 82, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: T.x - 30, y: T.y - 12, w: 14, d: 24, r: 3 }, 3.6, 3, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf({ x: T.x - 17, y: T.y - 52, w: 11, d: 104, r: 6 }, 54, 66, P, 8, 0.8), { tone: "mid" }));
  const body = { x: MON.x0, y: MON.y0, w: MON.x1 - MON.x0, d: MON.y1 - MON.y0, r: 3.5 };
  out.push(S(k.slabOf(body, MON.z0, MON.z1 - MON.z0, P, 6, 1.2), { tone: "hi" }));
  const vents = [];
  for (let i = 0; i < 12; i++) vents.push(k.planOutline({ x: MON.x0 + 3, y: T.y - 40 + i * 7, w: 6, d: 2.4, r: 1.2 }, MON.z1, P, 3));
  out.push(Ln(vents.join(""), { tone: "faint" }));
  out.push(screenT());
  const front = planeMatrix([MON.x1, MON.y1, MON.z0], [0, -1, 0], [0, 0, -1]);
  const top = -(MON.z1 - MON.z0) + 3.5;
  out.push(
    onPlane(
      front,
      D([[80, -6.5]], { size: 0.9, tone: "hi" }) + `<circle class="dv-socket" cx="80" cy="${top}" r="1.3"/>` + Ln(`M78.4 ${top}a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z`, { tone: "lo" }),
    ),
  );
  const end = planeMatrix([MON.x0, MON.y1, MON.z0 + 24], [1, 0, 0], [0, 0, -1]);
  out.push(onPlane(end, Ln(rect(3.6, 0, 8.4, 2.4, 1.2, 3) + rect(3.6, 5, 8.4, 7.4, 1.2, 3) + `M6 11.2a1.2 1.2 0 1 0 0.01 0Z`, { tone: "lo" })));
  out.push(keyboard(KB));
  return out.join("");
}

function screenT() {
  const w = GLASS.y1 - GLASS.y0;
  const h = GLASS.z1 - GLASS.z0;
  const clip = nextId();
  const line = (part, y, value, size, tone) => `<g data-part="${part}">${text(7, y, value, size, "dv-t", ` data-tone="${tone}"`)}</g>`;
  const inner = [
    `<clipPath id="${clip}"><path d="${rect(0, 0, w, h, 2)}"/></clipPath>`,
    `<path class="dv-glass" d="${rect(0, 0, w, h, 2)}"/>`,
    `<g clip-path="url(#${clip})">`,
    line("t-login", 12, "$ kiwi login", 7.4, "mid"),
    line("t-signed", 22, "signed in", 6, "lo"),
    line("t-ask", 31, "type these digits in your app:", 6, "lo"),
    line("t-digits", 59, `${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`, 26, "hi"),
    line("t-kept", 77, "kept in ~/.kiwi/machine.json", 6.4, "hi"),
    `</g>`,
    Ln(rect(0, 0, w, h, 2), { tone: "lo" }),
  ];
  return onPlane(SCREEN_T, inner.join(""));
}

function keyboard(kb) {
  const out = [`<path class="iso-halo" d="${k.haloOf(kb, 0, 3, P)}"/>`];
  out.push(feet(kb, 7, 2.6, 1));
  out.push(S(k.slabOf(kb, 1, 4.4, P, 6, 0.8), { tone: "mid" }));
  const top = 5.4;
  out.push(Ln(k.planOutline({ x: kb.x + 3, y: kb.y + 3, w: kb.w - 6, d: kb.d - 6, r: 2 }, top, P, 4), { tone: "lo" }));
  const pitch = 9.3;
  const rows = [Array(13).fill(1), Array(13).fill(1), Array(13).fill(1), [1.5, 1.25, 6.5, 1.25, 1.5, 1]];
  const keys = [];
  rows.forEach((row, i) => {
    let y = kb.y + 4.4;
    for (const width of row) {
      const plan = { x: kb.x + 4.6 + i * 10, y: y + 0.6, w: 8.6, d: width * pitch - 1.2, r: 1.3 };
      keys.push({ plan, depth: k.depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, 0], P) });
      y += width * pitch;
    }
  });
  keys.sort((a, b) => a.depth - b.depth);
  for (const { plan } of keys) out.push(S(k.slabOf(plan, top, 2.2, P, 3, 0.35), { tone: "mid" }) + Ln(k.planOutline(k.insetPlan(plan, 1.5), top + 2.2, P, 3), { tone: "faint" }));
  return out.join("");
}

function computer() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PC, 0, 10, P)}"/>`];
  out.push(feet(PC, 13, 4, PC_Z[0]));
  const [z0, z1] = PC_Z;
  out.push(S(k.slabOf(PC, z0, z1 - z0, P, 8, 1.4), { tone: "hi", inner: Ln(k.sideSeam(PC, z0 + 3.2, P, 8), { tone: "faint" }) }));
  out.push(Ln(k.planOutline(k.insetPlan(PC, 4), z1, P, 8), { tone: "faint" }));
  out.push(S(k.slabOf(SLOT, z1 - 0.01, 0.01, P, 3), { tone: "lo", flat: true, crease: "none" }));
  out.push(`<path class="dv-socket" d="${k.planOutline(SLOT, z1, P, 3)}"/>`);
  out.push(Ln(k.planOutline(SLOT, z1, P, 3), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(SLOT, -2.2), z1, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(planeMatrix([LABEL_AT[0], LABEL_AT[1], z1], [0, -1, 0], [1, 0, 0]), "~/.kiwi", { size: 5.4, tone: "mid" }));
  const screws = k.corners(PC, 9);
  out.push(
    D(
      screws.map(([x, y]) => at([x, y, z1])),
      { size: 0.45, tone: "lo" },
    ),
  );
  const front = planeMatrix([PC.x + PC.w, PC.y + PC.d, z1], [0, -1, 0], [0, 0, -1]);
  const face = [
    `<circle class="dv-led" data-part="led" data-on cx="12" cy="11" r="1.6"/>`,
    Ln(rect(20, 9, 28, 13, 1, 3) + rect(31, 9, 39, 13, 1, 3) + `M45.6 11a1.4 1.4 0 1 0 0.01 0Z`, { tone: "lo" }),
    `<path class="dv-socket" d="${rect(21, 10, 27, 12, 0.6, 3)}"/><path class="dv-socket" d="${rect(32, 10, 38, 12, 0.6, 3)}"/>`,
    Ln(`M54.6 9.4a2.4 2.4 0 1 0 2.8 0`, { tone: "mid", free: true }) + Ln(`M56 8.2V11.2`, { tone: "mid", free: true }),
  ];
  out.push(onPlane(front, face.join("")));
  const side = planeMatrix([PC.x, PC.y + PC.d, z1], [1, 0, 0], [0, 0, -1]);
  const slots = [];
  for (let i = 0; i < 9; i++) slots.push(rect(14 + i * 4.4, 7, 16 + i * 4.4, 17, 1, 3));
  out.push(onPlane(side, Ln(slots.join(""), { tone: "faint" })));
  return out.join("");
}

function tray() {
  const out = [`<path class="iso-halo" d="${k.haloOf(TRAY, 0, 4, P)}"/>`];
  const [z0, z1] = TRAY_Z;
  out.push(S(k.slabOf(TRAY, z0, z1 - z0, P, 6, 0.6), { tone: "mid" }));
  const well = k.insetPlan(TRAY, 2.6);
  out.push(S(k.slabOf(well, z1 - 0.01, 0.01, P, 6), { tone: "lo", flat: true, crease: "none" }));
  out.push(Ln(k.planOutline(well, z1, P, 6), { tone: "lo" }));
  out.push(
    D(
      k.corners(TRAY, 1.4).map(([x, y]) => at([x, y, z1])),
      { size: 0.4, tone: "lo" },
    ),
  );
  return out.join("");
}

function cardSvg() {
  const theta = Math.PI / 2;
  const vMin = CARD_TOP - CARD_SLOT[2];
  const paths = cardPaths(CARD_SLOT, theta, vMin);
  const clip = nextId();
  const visible = CARD.h / 2 - vMin;
  const marks = [
    Ln(`M3 4.4H17`, { tone: "hi", free: true }),
    Ln(`M3 7.8H13.5`, { tone: "lo", free: true }),
    Ln(`M3 11.2H15.5`, { tone: "lo", free: true }),
    `<g data-part="seal"><path class="dv-ink" d="M31 7a5 5 0 1 0 -10 0a5 5 0 1 0 10 0ZM29.4 7a3.4 3.4 0 1 0 -6.8 0a3.4 3.4 0 1 0 6.8 0Z"/><path class="dv-ink" d="M24.4 7.1l1.2 1.3l2.2-2.6"/></g>`,
  ];
  const parts = [
    `<path class="iso-fill" data-c="fill" d="${paths.fill}"/>`,
    ...paths.shades.map((d, i) => `<path class="iso-shade" data-shade="${i}" data-c="s${i}" d="${d}"/>`),
    `<path class="iso-top" data-c="top" d="${paths.top}"/>`,
    `<path class="iso-line iso-crease" data-tone="faint" data-c="crease" d="${paths.crease}"/>`,
    `<g data-part="face" transform="${cardFace(CARD_SLOT, theta)}"><clipPath id="${clip}"><rect data-part="face-clip" x="-1" y="-1" width="${CARD.w + 2}" height="${visible + 1}"/></clipPath><g clip-path="url(#${clip})">${marks.join("")}</g></g>`,
    `<path class="iso-line iso-edge" data-tone="hi" data-c="outline" d="${paths.outline}"/>`,
  ];
  return `<g class="iso-solid" data-part="card" data-lit>${parts.join("")}</g>`;
}

function stamp() {
  const [x, y] = STAMP_REST;
  const out = [];
  const block = { x: x - 11, y: y - 14, w: 22, d: 28, r: 2.2 };
  out.push(S(k.slabOf(k.insetPlan(block, 0.8), 0, 2, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf(block, 2, 7, P, 3, 0.6), { tone: "mid", inner: Ln(k.sideSeam(block, 5.2, P, 3), { tone: "faint" }) }));
  const F = G.frameOf([x, y, 9], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const handle = [
    [0, 5.2],
    [1.2, 5.2],
    [1.2, 3.2],
    [2.6, 2.8, 1],
    [5, 2.9, 1],
    [8, 4.4, 1],
    [11, 6.2, 1],
    [14, 6.4, 1],
    [16.6, 5, 1],
    [18.4, 2.6, 1],
    [19.2, 0, 1],
  ];
  const ring = (r) => `M${r} 0a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0Z`;
  out.push(onPlane(planeMatrix([x, y + 9.4, 9], [0, -1, 0], [1, 0, 0]), Ln(ring(3.3) + ring(2.3), { tone: "lo" }) + Ln("M-1 0.1L-0.25 0.9L1.15 -0.75", { tone: "lo", free: true })));
  out.push(S(G.solidOf(handle, F, P), { tone: "hi" }));
  return `<path class="iso-halo" data-part="stamp-halo" d="${k.haloOf(block, 0, 4, P)}"/><g data-part="stamp">${out.join("")}</g>`;
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
  const rows = [Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), Array(12).fill(1), [1.5, 1.25, 6.5, 1.25, 1.5]];
  const keys = [];
  rows.forEach((row, j) => {
    let x = well.x + 2;
    row.forEach((width, c) => {
      const plan = { x: x + 0.7, y: well.y + 1.6 + j * 7.8, w: width * 10 - 1.4, d: 6.4, r: 1 };
      keys.push({ plan, tag: j === 0 ? c : -1, depth: k.depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, 0], P) });
      x += width * 10;
    });
  });
  keys.sort((a, b) => a.depth - b.depth);
  for (const { plan, tag } of keys) {
    const key = S(k.slabOf(plan, z1 - 0.6, 1.3, P, 2, 0.3), { tone: "mid" });
    out.push(tag >= 0 ? `<g data-key="${tag}">${key}</g>` : key);
  }
  const pad = { x: LAP.x - 27, y: BASE.y + 57, w: 54, d: 33, r: 3 };
  out.push(Ln(k.planOutline(pad, z1, P, 5), { tone: "lo" }));
  out.push(Ln(k.planOutline(k.insetPlan(pad, 1.2), z1, P, 5), { tone: "faint" }));
  out.push([LAP.x - 68.5, LAP.x + 64.2].map((x) => D(k.dotGrid(x, BASE.y + 11, 3, 12, 1.5, z1, P), { size: 0.35, tone: "lo" })).join(""));
  const side = planeMatrix([BASE.x + BASE.w, BASE.y + BASE.d, z1], [0, -1, 0], [0, 0, -1]);
  out.push(onPlane(side, Ln(rect(22, 3.2, 31, 6, 1.4) + rect(35, 3.2, 44, 6, 1.4) + rect(50, 3.4, 53, 5.8, 1.2), { tone: "lo" })));
  out.push(S(G.disc(-60, 60, 2.4, G.frameAlong([LAP.x, HINGE[1], HINGE[2]], [1, 0, 0]), P), { tone: "mid" }));
  const F = G.frameOf(HINGE, LID_OUT, [1, 0, 0], LID_UP);
  const outline = k.roundedPlan({ x: LID.u0, y: LID.v0, w: LID.u1 - LID.u0, d: LID.v1 - LID.v0, r: LID.r }, 6);
  out.push(S(G.prismOf(F, outline, -LID.t, 0, P), { tone: "hi" }));
  out.push(screenL());
  return out.join("");
}

function deviceIcon(v, kind) {
  if (kind === "phone") return Ln(rect(10.6, v - 3.4, 14, v + 2.6, 0.8, 3), { tone: "mid" });
  if (kind === "mini") return Ln(rect(9.4, v - 2.2, 15.2, v + 1.8, 1.3, 3) + rect(11.2, v - 0.9, 13.4, v - 0.2, 0.3, 2), { tone: "mid" });
  return Ln(rect(9, v - 3.2, 15.6, v + 1.2, 0.6, 3) + `M11.7 ${v + 1.2}L11.2 ${v + 2.8}H13.4L12.9 ${v + 1.2}`, { tone: "mid" });
}

function screenL() {
  const w = DISPLAY.u1 - DISPLAY.u0;
  const h = DISPLAY.v1 - DISPLAY.v0;
  const clip = nextId();
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const u = boxU(i);
    boxes.push(`<path class="dv-box" data-box="${i}" d="${rect(u, BOXES.v0, u + BOXES.w, BOXES.v1, 1.6)}"/>`);
    boxes.push(`<g data-digit="${i}">${text((u + BOXES.w / 2).toFixed(2), BOXES.v1 - 3.6, DIGITS[i], 11, "dv-t", ' data-tone="hi" text-anchor="middle"')}</g>`);
  }
  const rows = ROWS.map(({ v, name }, i) => {
    const row = `${deviceIcon(v, name)}${text(20, v + 1.9, name, 5.6, "dv-t", ' data-tone="hi"')}${text(84, v + 1.6, "Remove", 4.6, "dv-t", ' data-tone="lo"')}${Ln(`M0 ${v + 5}H${w}`, { tone: "faint" })}`;
    return i === ROWS.length - 1 ? `<g data-part="row-new">${row}</g>` : row;
  });
  const inner = [
    `<clipPath id="${clip}"><path d="${rect(0, 0, w, h, 1.2)}"/></clipPath>`,
    `<path class="dv-glass" d="${rect(0, 0, w, h, 1.2)}"/>`,
    `<g clip-path="url(#${clip})">`,
    Ln(`M0 7H${w}`, { tone: "faint" }),
    `<circle class="dv-dot" cx="4" cy="3.5" r="1.1"/><circle class="dv-dot" cx="8" cy="3.5" r="1.1"/><circle class="dv-dot" cx="12" cy="3.5" r="1.1"/>`,
    text(9, 15.6, "Add a computer", 6, "dv-t", ' data-tone="hi"'),
    boxes.join(""),
    Ln(`M0 ${43}H${w}`, { tone: "faint" }),
    rows.join(""),
    `<g data-part="cursor" transform="translate(${CURSOR_REST[0]} ${CURSOR_REST[1]})"><path class="dv-cursor" d="M0 0V8.6L2.2 6.6L3.7 10L5.3 9.3L3.8 6H6.9Z"/></g>`,
    `</g>`,
    Ln(rect(0, 0, w, h, 1.2), { tone: "lo" }),
  ];
  const cam = onPlane(planeMatrix(lidPoint(0, DISPLAY.v1 + 2.6), [1, 0, 0], [0, -LID_UP[1], -LID_UP[2]]), `<circle class="dv-socket" cx="0" cy="0" r="1"/>`);
  return onPlane(SCREEN_L, inner.join("")) + cam;
}

export default function figure() {
  ids = 0;
  const body = [STYLE, terminal(), computer(), tray(), laptop(), cardSvg(), stamp()];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A small computer with a monitor on the left, the owner's laptop on the right, and a rubber stamp beside a card tray between them. The computer's terminal shows kiwi login and six digits, 205 618, and the same digits are typed into the Channels app on the laptop, which lists the computer among your devices. The app's stamp marks a certificate card for that computer, and the card drops into a slot on the computer labelled ~/.kiwi, where it stays; the stamp itself never leaves the laptop's side. Removing the computer in the app takes its card back out and its light goes dark.",
    body,
  });
}
