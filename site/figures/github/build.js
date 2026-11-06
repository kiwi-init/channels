import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import {
  APP,
  GH,
  cipherOf,
  GH_ROUTE,
  HEIGHT,
  HINGE,
  HOUSING,
  LAP,
  LAP_ROUTE,
  OPEN,
  P,
  PACKET,
  PORT_GH,
  PORT_IN,
  PORT_OUT,
  RELAY,
  SLIP,
  SLOT,
  TRAY,
  TRAYS,
  WIDTH,
  at,
  lidPaths,
  planeMatrix,
  screenMatrix,
  slipPaths,
  slipRest,
  slipText,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const halo = (plan, z, h) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (x0, y0, x1, y1, r = 0, steps = 4) => k.pathOf(k.roundedPlan({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, steps), true);
const nb = (value) => value.replace(/ /g, "&#160;");
const text = (x, y, value, { size = 6, tone = "mid", cls = "", anchor = "start", attrs = "" } = {}) =>
  `<text class="iso-face-text${cls ? ` ${cls}` : ""}" data-tone="${tone}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}"${attrs}>${nb(value)}</text>`;
const onFaceY = (y, x0, ztop) => planeMatrix([x0, y, ztop], [1, 0, 0], [0, 0, -1]);
const onFaceX = (x, y0, ztop) => planeMatrix([x, y0, ztop], [0, -1, 0], [0, 0, -1]);
const xDisc = (x0, x1, y, z, r) => G.disc(0, x1 - x0, r, G.frameOf([x0, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]), P);

function liveSolid(paths, { tone = "hi", attrs = "", inner = "" } = {}) {
  const shades = [0, 1, 2, 3].map((i) => `<path class="iso-shade" data-shade="${i}" d="${paths.shades[i] || ""}"/>`).join("");
  return `<g class="iso-solid"${attrs}><path class="iso-fill" d="${paths.fill}"/>${shades}<path class="iso-top" d="${paths.top}"/><path class="iso-line iso-crease" data-tone="faint" d="${paths.crease || ""}"/>${inner}<path class="iso-line iso-edge" data-tone="${tone}" d="${paths.outline}"/></g>`;
}

function feet(plan, inset, r, h) {
  return byDepth(k.corners(plan, inset))
    .map(([x, y]) => S(k.cylinder(x, y, r, 0, h, P, 16), { tone: "lo" }))
    .join("");
}

function jackY(x, y, z) {
  return S(k.slabOf({ x: x - 3.6, y, w: 7.2, d: 2.2, r: 0.6 }, z - 3, 6, P, 2), { tone: "lo" });
}

function jackX(x, y, z) {
  return S(k.slabOf({ x, y: y - 3.6, w: 2.2, d: 7.2, r: 0.6 }, z - 3, 6, P, 2), { tone: "lo" });
}

function server() {
  const out = [halo(GH, 0, 8), feet(GH, 6, 2.8, GH.z)];
  const seam = k.sideSeam(GH, GH.top - 7, P, 3);
  out.push(S(k.slabOf(GH, GH.z, GH.top - GH.z, P, 3, 0.6), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  const front = GH.x + GH.w;
  const y0 = GH.y + GH.d;
  const units = [];
  const leds = [];
  for (let i = 0; i < 6; i++) {
    const v = 11 + i * 10.6;
    units.push(L(rect(3, v, GH.d - 3, v + 9.6, 0.8), { tone: "lo" }));
    for (let j = 0; j < 4; j++) units.push(L(rect(16 + j * 9, v + 2.4, 23.4 + j * 9, v + 7.2, 0.5), { tone: "faint" }));
    units.push(L(rect(5, v + 2.6, 8, v + 7, 0.6), { tone: "lo" }));
    units.push(L(rect(GH.d - 8, v + 2.6, GH.d - 5, v + 7, 0.6), { tone: "lo" }));
    leds.push(at([front, y0 - 11.4, GH.top - v - 4.8]));
  }
  out.push(`<g transform="${onFaceX(front, y0, GH.top)}">${units.join("")}</g>`);
  out.push(D(leds, { size: 0.55, tone: "mid" }));
  const vents = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) vents.push(rect(8 + c * 8, 12 + r * 5, 13 + c * 8, 14.2 + r * 5, 0.6, 2));
  out.push(`<g transform="${onFaceY(y0, GH.x, GH.top)}">${L(vents.join(""), { tone: "faint" })}${L(rect(8, 56, 38, 66, 0.8), { tone: "lo" })}</g>`);
  out.push(
    D(
      [
        [4, 4],
        [GH.w - 4, 4],
        [4, GH.top - GH.z - 4],
        [GH.w - 4, GH.top - GH.z - 4],
      ].map(([u, v]) => at([GH.x + u, y0, GH.top - v])),
      { size: 0.5, tone: "mid" },
    ),
  );
  for (let i = 0; i < 5; i++) out.push(L(k.planOutline({ x: GH.x + 9, y: GH.y + 10 + i * 8, w: 28, d: 3, r: 1.2 }, GH.top, P, 2), { tone: "faint" }));
  out.push(jackY(PORT_GH[0], y0, PORT_GH[2]));
  return out.join("");
}

function relayBody() {
  const out = [halo(RELAY, 0, 8), feet(RELAY, 8, 3, RELAY.z)];
  const seam = k.sideSeam(RELAY, RELAY.top - 7, P, 3);
  out.push(S(k.slabOf(RELAY, RELAY.z, RELAY.top - RELAY.z, P, 3, 0.8), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  const front = RELAY.y + RELAY.d;
  const rows = [0, 1, 2].map((i) => text(10.6, 18 + i * 6, cipherOf(i), { size: 3.8, tone: i === 2 ? "hi" : "mid", cls: "gh-mono", attrs: ` data-cipher="${i}"` })).join("");
  const face = [
    `<path class="gh-glass" d="${rect(8, 11, 62, 33, 1.4)}"/>`,
    `<g data-part="cipher">${rows}</g>`,
    L(rect(8, 11, 62, 33, 1.4), { tone: "lo" }),
    L(rect(68, 26, 84, 33, 0.8), { tone: "lo" }),
    L(rect(40, 39, 62, 45, 0.8), { tone: "faint" }),
  ].join("");
  out.push(`<g transform="${onFaceY(front, RELAY.x, RELAY.top)}">${face}</g>`);
  out.push(D([70, 74.5, 79].map((u) => at([RELAY.x + u, front, RELAY.top - 15])).concat([at([RELAY.x + 76, front, RELAY.top - 29.5])]), { size: 0.6, tone: "hi" }));
  out.push(
    D(
      [
        [3.4, 3.4],
        [RELAY.w - 3.4, 3.4],
        [3.4, RELAY.top - RELAY.z - 3.4],
        [RELAY.w - 3.4, RELAY.top - RELAY.z - 3.4],
      ].map(([u, v]) => at([RELAY.x + u, front, RELAY.top - v])),
      { size: 0.5, tone: "mid" },
    ),
  );
  const side = RELAY.x + RELAY.w;
  const slots = Array.from({ length: 11 }, (_, i) => rect(10 + i * 4.4, 12, 12 + i * 4.4, 30, 0.9, 2)).join("");
  out.push(`<g transform="${onFaceX(side, front, RELAY.top)}">${L(slots, { tone: "faint" })}</g>`);
  out.push(jackY(PORT_IN[0], front, PORT_IN[2]));
  out.push(jackX(side, PORT_OUT[1], PORT_OUT[2]));
  return out.join("");
}

function housing() {
  const out = [];
  out.push(S(k.slabOf(HOUSING, RELAY.top, HOUSING.top - RELAY.top, P, 3, 0.6), { tone: "mid" }));
  const h = HOUSING.top;
  const u0 = SLOT.x0 - HOUSING.x;
  const u1 = SLOT.x1 - HOUSING.x;
  const v = h - SLOT.z;
  out.push(`<g transform="${onFaceY(SLOT.y, HOUSING.x, h)}"><path class="gh-slot" d="${rect(u0, v - 1.3, u1, v + 1.3, 1.2)}"/>${L(rect(u0 - 2, v - 3.4, u1 + 2, v + 3.4, 2), { tone: "faint" })}</g>`);
  out.push(
    D(
      [
        [2.6, 2.6],
        [HOUSING.w - 2.6, 2.6],
      ].map(([u, vv]) => at([HOUSING.x + u, SLOT.y, h - vv])),
      { size: 0.45, tone: "mid" },
    ),
  );
  out.push(L(k.planOutline(k.insetPlan(HOUSING, 3), h, P, 3), { tone: "faint" }));
  return out.join("");
}

const SLIPS = [
  ["acme/app", "PR #42 opened", "fix login", "by ana"],
  ["acme/app", "ci passed", "fix-login", "a1f3c9e"],
  ["acme/app", "PR #42 merged", "into main", "by ana"],
];

function slipFace(lines, tone) {
  return lines.map((line, i) => text(2.2, 6.4 + i * 5, line, { size: 3.2, tone: i === 1 ? tone : "lo", cls: "gh-mono" })).join("");
}

function slip(i) {
  const at0 = slipRest(i);
  const paths = slipPaths(at0.x, at0.y, at0.y + SLIP.d, at0.z);
  return `<g data-slip="${i}">${liveSolid(paths, { tone: "hi" })}<g data-slip-face transform="${slipText(at0.x, at0.y, at0.z)}">${slipFace(SLIPS[i], "hi")}</g></g>`;
}

function waiting(tray) {
  const x = tray.x + (TRAY.w - SLIP.w) / 2 - 0.6;
  const y = TRAY.y + 10;
  const z = RELAY.top + TRAY.floor;
  return `${S(slipPaths(x, y, y + SLIP.d, z), { tone: "mid" })}<g transform="${slipText(x, y, z)}">${slipFace(["acme/api", "push main", "3 commits", "by leo"], "mid")}</g>`;
}

function tray(t, inside) {
  const { wall, h, d, w } = TRAY;
  const z0 = RELAY.top;
  const z1 = z0 + TRAY.floor;
  const out = [];
  out.push(S(k.slabOf({ x: t.x, y: TRAY.y, w, d, r: 1 }, z0, TRAY.floor, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: t.x, y: TRAY.y, w, d: wall, r: 0.3 }, z1, h, P, 1), { tone: "mid" }));
  out.push(S(k.slabOf({ x: t.x, y: TRAY.y + wall, w: wall, d: d - wall * 2, r: 0.3 }, z1, h, P, 1), { tone: "mid" }));
  out.push(inside);
  out.push(S(k.slabOf({ x: t.x + w - wall, y: TRAY.y + wall, w: wall, d: d - wall * 2, r: 0.3 }, z1, h, P, 1), { tone: "mid" }));
  const lip = { x: t.x, y: TRAY.y + d - wall, w, d: wall, r: 0.3 };
  const card = `<g transform="${onFaceY(TRAY.y + d, t.x, z1 + h)}"><path class="gh-label" d="${rect(5, 1.2, w - 5, h - 1.2, 0.5)}"/>${text(w / 2, h - 2, `# ${t.name}`, { size: 3.2, tone: t === APP ? "hi" : "mid", anchor: "middle", cls: "gh-sans" })}</g>`;
  out.push(S(k.slabOf(lip, z1, h, P, 1), { tone: "mid", inner: card }));
  return out.join("");
}

function trays() {
  return TRAYS.map((t) => tray(t, t === APP ? `<g data-part="slips">${[0, 1, 2].map(slip).join("")}</g>` : waiting(t))).join("");
}

const OLD_ROWS = [
  ["ana", "merging after review"],
  ["claude", "tests pass on fix-login"],
];
const NEW_ROWS = [
  ["github", "PR #42 opened: fix login"],
  ["github", "ci passed on fix-login"],
  ["github", "PR #42 merged into main"],
];

function row([who, line], y, attrs = "") {
  return `<g${attrs}>${text(40, y, who, { size: 3.8, tone: "lo", cls: "gh-sans" })}${text(56, y, line, { size: 4.2, tone: "hi", cls: "gh-sans" })}</g>`;
}

function laptop() {
  const out = [];
  const base = { x: LAP.x, y: LAP.y, w: LAP.w, d: LAP.d, r: 6 };
  out.push(halo(base, 0, 6));
  for (const [x, y] of byDepth(k.corners(base, 10))) out.push(S(k.cylinder(x, y, 3, 0, 0.8, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf(base, 0.8, LAP.h - 0.8, P, 6, 0.8), { tone: "mid" }));
  const deck = LAP.h;
  out.push(L(k.planOutline({ x: LAP.x + 9, y: LAP.y + 13, w: LAP.w - 18, d: 47, r: 2 }, deck, P, 3), { tone: "faint" }));
  const U = 9.4;
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 13; i++) {
      out.push(L(k.planOutline({ x: LAP.x + 10.6 + i * U, y: LAP.y + 15 + r * 11, w: U - 2, d: 9, r: 1.2 }, deck, P, 2), { tone: "lo" }));
    }
  }
  out.push(L(k.planOutline({ x: LAP.x + 42, y: LAP.y + 64, w: 56, d: 26, r: 2.6 }, deck, P, 3), { tone: "lo" }));
  for (const y of [LAP.y + 30, LAP.y + 40]) out.push(`<g transform="${onFaceX(LAP.x + LAP.w, y + 6, deck - 1.4)}">${L(rect(0, 0, 6, 2.6, 1, 2), { tone: "lo" })}</g>`);
  out.push(S(xDisc(LAP.x + 12, LAP.x + LAP.w - 12, HINGE[1], HINGE[2], 2.4), { tone: "lo" }));
  out.push(liveSolid(lidPaths(OPEN), { tone: "mid", attrs: ' data-part="lid"' }));
  const win = { x0: 6, x1: LAP.w - 6, y0: 6, y1: LAP.lid - 10 };
  const app = [
    `<path class="gh-glass" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
    `<g data-part="app">`,
    `<path class="iso-line" data-tone="faint" d="M34 ${win.y0}V${win.y1}"/>`,
    ...["# general", "# app", "# ops", "# web"].map((name, i) => text(10, 16 + i * 8.5, name, { size: 4, tone: i === 1 ? "hi" : "lo", cls: "gh-sans" })),
    text(40, 16, "# app", { size: 5.4, tone: "hi", cls: "gh-sans" }),
    ...OLD_ROWS.map((r, i) => row(r, 28 + i * 9)),
    ...NEW_ROWS.map((r, i) => row(r, 46 + i * 9, ` data-row="${i}"`)),
    `</g>`,
    `<path class="iso-line" data-tone="faint" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
  ];
  out.push(`<g data-part="screen" transform="${screenMatrix(OPEN)}">${app.join("")}</g>`);
  return out.join("");
}

function packet() {
  const { w, d, h } = PACKET;
  const plan = { x: -w / 2, y: -d / 2, w, d, r: 0.8 };
  const z = 2.2;
  const lock = `<g transform="${onFaceY(d / 2, -w / 2, z + h)}"><path class="iso-line" data-tone="lit" d="M3.3 3.4V2.4A1.2 1.2 0 0 1 5.7 2.4V3.4"/><path class="gh-lock" d="${rect(2.6, 3.4, 6.4, 5.6, 0.4)}"/></g>`;
  const tape = k.pathOf([at([-w / 2, 0, z + h]), at([w / 2, 0, z + h])]);
  return `<g data-part="packet" opacity="0">${S(k.slabOf(plan, z, h, P, 2, 0.4), { tone: "lit", lit: true, inner: L(tape, { tone: "lo" }) + lock })}</g>`;
}

function cable(route, keep) {
  const pieces = tubePieces(route, 1.1, P, { maxLength: 24, breaks: [12] });
  return pieces
    .filter((piece) => keep(piece))
    .map((piece) => tubeSvg(piece, { tone: "mid" }))
    .join("");
}

const STYLE = `<style>
[data-figure="github"] .gh-glass{fill:var(--anatomy-shade-0)}
[data-figure="github"] .gh-slot{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="github"] .gh-label{fill:var(--anatomy-top);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="github"] .gh-lock{fill:var(--anatomy-lit);stroke:var(--anatomy-lit);stroke-width:var(--anatomy-weight)}
[data-figure="github"] .gh-pulse{fill:none;stroke:var(--anatomy-lit);stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round}
[data-figure="github"] [data-cipher][data-on]{fill:var(--anatomy-lit)}
[data-figure="github"] .gh-mono{font-family:var(--anatomy-mono);letter-spacing:0}
[data-figure="github"] .gh-sans{font-family:var(--sans,system-ui);letter-spacing:0}
</style>`;

export default function figure() {
  const nearLaptop = (piece) => piece.to <= 12.5;
  const body = [
    STYLE,
    server(),
    relayBody(),
    housing(),
    trays(),
    cable(LAP_ROUTE, nearLaptop),
    laptop(),
    cable(LAP_ROUTE, (piece) => !nearLaptop(piece)),
    `<path class="gh-pulse" data-part="pulse-lap" d=""/>`,
    cable(GH_ROUTE, () => true),
    `<path class="gh-pulse" data-part="pulse-gh" d=""/>`,
    packet(),
  ];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A plain server on the left sends GitHub's webhooks down a cable to a small relay box. For each one, a short printed slip (the repo, the pull request and its title, the check and its result, who did it) slides out of a mail slot on the relay and drops into the tray labelled # app, one of three trays for three channels. The slips pile up while the owner's laptop is shut. When the laptop opens, the slips leave the tray, the app shows each as a line in the # app channel, and sends each back to the relay as a padlocked packet, which the relay's screen shows only as scrambled text.",
    body,
  });
}
