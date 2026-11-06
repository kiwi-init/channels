import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import { ARM, BOX, CAB, CONV, ENDBOX, GLAND_LAP, LAP_ROUTE, MON_ROUTE, HEIGHT, HUB, LAP, LID, MON, P, PORT_MON, REST, ROLLERS, TRAVEL, WIDTH, armPaths, at, boxAt, planeMatrix } from "./model.js";

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

function legOf(x, y) {
  return [S(k.cylinder(x, y + 1.6, 2.8, 0, 1.2, P, 18), { tone: "lo" }), S(k.slabOf({ x: x - 1.8, y, w: 3.6, d: 3.2, r: 0.4 }, 1.2, CONV.zLow - 1.2, P, 2), { tone: "mid" })].join("");
}

const LEGS = [CONV.x0 + 10, -200, -40];

function conveyorBack() {
  const out = [];
  for (const x of LEGS) out.push(legOf(x, CONV.yFar));
  for (const x of LEGS) out.push(S(k.slabOf({ x: x - 1, y: CONV.yFar + 3.2, w: 2, d: CONV.yNear - CONV.yFar - 6.4, r: 0.3 }, 4, 2, P, 2), { tone: "lo" }));
  const far = { x: CONV.x0, y: CONV.yFar, w: CONV.x1 - CONV.x0, d: CONV.wall, r: 0.5 };
  out.push(S(k.slabOf(far, CONV.zLow, CONV.zTop - CONV.zLow, P, 2, 0.4), { tone: "mid" }));
  const inner = CONV.yFar + CONV.wall;
  for (const x of ROLLERS) {
    const F = G.frameOf([x, inner, CONV.axle], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    out.push(S(G.disc(0, CONV.yNear - CONV.yFar - CONV.wall * 2, CONV.roller, F, P), { tone: "mid" }));
  }
  out.push(
    D(
      ROLLERS.map((x) => at([x, inner, CONV.axle])),
      { size: 0.45, tone: "lo" },
    ),
  );
  return out.join("");
}

function conveyorFront() {
  const out = [];
  for (const x of LEGS) out.push(legOf(x, CONV.yNear - 3.2));
  const near = { x: CONV.x0, y: CONV.yNear - CONV.wall, w: CONV.x1 - CONV.x0, d: CONV.wall, r: 0.5 };
  const seam = k.sideSeam(near, CONV.zLow + 3.4, P, 2);
  out.push(S(k.slabOf(near, CONV.zLow, CONV.zTop - CONV.zLow, P, 2, 0.4), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  out.push(
    D(
      ROLLERS.map((x) => at([x, CONV.yNear, CONV.axle])),
      { size: 0.6, tone: "mid" },
    ),
  );
  out.push(motor());
  return out.join("");
}

function motor() {
  const out = [];
  const mx = CONV.x1 - 30;
  const y0 = CONV.yNear;
  const F = G.frameOf([mx, y0, CONV.axle], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  out.push(S(G.disc(0, 2.4, 7.4, F, P), { tone: "lo" }));
  const ribs = G.ribsOf(F, 4.4, 15.6, 6.2, 22, P, { fade: [0.1, 0.55], seams: true });
  out.push(S(G.disc(2.4, 4.4, 6.6, F, P), { tone: "mid" }));
  out.push(S(G.disc(4.4, 15.6, 6.2, F, P), { tone: "mid", inner: k.fadedSvg(ribs, { tone: "lo" }) }));
  out.push(S(G.disc(15.6, 17.4, 5, F, P), { tone: "mid" }));
  out.push(D(G.dotsOf(F, 17.4, 3, 4, P, { all: true }), { size: 0.45, tone: "mid" }));
  out.push(S(k.slabOf({ x: mx - 4, y: y0 + 6, w: 8, d: 7, r: 0.8 }, CONV.axle + 6, 4.4, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([mx - 2, y0 + 9.5, CONV.axle + 10.4]), at([mx + 2, y0 + 9.5, CONV.axle + 10.4])], { size: 0.45, tone: "mid" }));
  return out.join("");
}

function parcel(x) {
  const plan = boxAt(x);
  const top = BOX.z + BOX.h;
  const mid = x + BOX.w / 2;
  const tape = k.pathOf([at([mid, BOX.y, top]), at([mid, BOX.y + BOX.d, top]), at([mid, BOX.y + BOX.d, BOX.z])]);
  const flap = k.pathOf([at([x, BOX.y + BOX.d / 2, top]), at([x + BOX.w, BOX.y + BOX.d / 2, top])]);
  const label = `<g transform="${onFaceY(BOX.y + BOX.d, x, top)}"><path class="pm-label" d="${rect(2.6, 3.4, BOX.w / 2 - 2.6, BOX.h - 2.6, 0.6)}"/><path class="pm-label" d="${rect(BOX.w / 2 + 2.6, 3.4, BOX.w - 2.6, BOX.h - 2.6, 0.6)}"/>${text(BOX.w / 4, 11.6, "git", { size: 4.4, tone: "hi", anchor: "middle", cls: "pm-mono" })}${text((BOX.w * 3) / 4, 11.6, "push", { size: 4.4, tone: "hi", anchor: "middle", cls: "pm-mono" })}</g>`;
  return S(k.slabOf(plan, BOX.z, BOX.h, P, 2, 0.5), { tone: "hi", inner: L(flap, { tone: "faint" }) + L(tape, { tone: "lo" }) + label });
}

function armSvg() {
  const paths = armPaths(0);
  const solid = (key, tone, extra = "") => {
    const p = paths[key];
    return `<g class="iso-solid" data-arm="${key}"><path class="iso-fill" d="${p.fill}"/>${p.shades.map((d, i) => `<path class="iso-shade" data-shade="${i}" d="${d}"/>`).join("")}<path class="iso-top" d="${p.top}"/><path class="iso-line iso-crease" data-tone="faint" d="${p.crease}"/>${extra}<path class="iso-line iso-edge" data-tone="${tone}" d="${p.outline}"/></g>`;
  };
  return `<g data-part="arm">${solid("boom", "hi", `<path class="iso-line" data-arm="bands" data-tone="lo" d="${paths.bands}"/>`)}${solid("tip", "hi")}</g>`;
}

function rest() {
  const out = [];
  const foot = { x: REST.x - 3, y: REST.y - 3, w: REST.w + 6, d: REST.d + 6, r: 1.2 };
  out.push(halo(foot, 0, 3));
  out.push(S(k.slabOf(foot, 0, 1.6, P, 3, 0.4), { tone: "lo" }));
  out.push(
    D(
      k.corners(foot, 1.6).map(([x, y]) => at([x, y, 1.6])),
      { size: 0.45, tone: "mid" },
    ),
  );
  out.push(S(k.slabOf({ x: REST.x, y: REST.y, w: REST.w, d: REST.d, r: 0.8 }, 1.6, REST.top - 4.6, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: REST.x - 1, y: REST.y - 1, w: REST.w + 2, d: REST.d + 2, r: 1 }, REST.top - 3, 3, P, 3), { tone: "lo" }));
  return out.join("");
}

function cabinet() {
  const out = [];
  const base = { x: CAB.x - 3, y: CAB.y - 3, w: CAB.w + 6, d: CAB.d + 6, r: 1.6 };
  out.push(S(xDisc(HUB.x0, HUB.x1, ARM.pivot[1], ARM.pivot[2], HUB.r), { tone: "mid" }));
  out.push(S(k.slabOf(base, 0, CAB.z, P, 3, 0.5), { tone: "lo" }));
  out.push(
    D(
      k.corners(base, 1.8).map(([x, y]) => at([x, y, CAB.z])),
      { size: 0.5, tone: "mid" },
    ),
  );
  const seam = k.sideSeam(CAB, CAB.top - 9, P, 3);
  out.push(S(k.slabOf(CAB, CAB.z, CAB.top - CAB.z, P, 3, 0.6), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  const h = CAB.top - CAB.z;
  out.push(
    `<g transform="${onFaceY(CAB.y + CAB.d, CAB.x, CAB.top)}">${L(rect(2.4, 11.6, CAB.w - 2.4, h - 3, 0.8), { tone: "lo" })}${L(rect(CAB.w - 5.4, 24, CAB.w - 4, 30, 0.7), { tone: "mid" })}</g>`,
  );
  out.push(D([at([CAB.x + 4.2, CAB.y + CAB.d, CAB.top - 22]), at([CAB.x + 4.2, CAB.y + CAB.d, CAB.top - 40])], { size: 0.55, tone: "mid" }));
  const slots = [0, 1, 2, 3, 4, 5].map((i) => rect(4 + i * 2.4, 14, 5.2 + i * 2.4, 26, 0.6, 2)).join("");
  out.push(`<g transform="${onFaceX(CAB.x + CAB.w, CAB.y + CAB.d, CAB.top)}">${L(slots, { tone: "faint" })}</g>`);
  out.push(S(xDisc(GLAND_LAP[0], GLAND_LAP[0] + 2.2, GLAND_LAP[1], GLAND_LAP[2], 2.3), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(CAB, -1.4), CAB.top, 2.8, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(CAB.x + CAB.w / 2, CAB.y + CAB.d / 2, 3.4, CAB.top + 2.8, 2, P, 24), { tone: "lo" }));
  out.push(
    S(
      G.solidOf(
        [
          [0, 3],
          [3.2, 3, 1],
          [4.6, 2.2, 1],
          [5.4, 0.8, 1],
          [5.6, 0],
        ],
        G.frameOf([CAB.x + CAB.w / 2, CAB.y + CAB.d / 2, CAB.top + 4.8], [0, 0, 1], [1, 0, 0], [0, 1, 0]),
        P,
      ),
      { tone: "mid" },
    ),
  );
  return out.join("");
}

function endBox() {
  const out = [halo(ENDBOX, 0, 8)];
  const plinth = k.insetPlan(ENDBOX, 2);
  out.push(S(k.slabOf(plinth, 0, 4, P, 4), { tone: "lo" }));
  const seam = k.sideSeam(ENDBOX, ENDBOX.h - 8, P, 4);
  out.push(S(k.slabOf(ENDBOX, 4, ENDBOX.h - 4, P, 4, 0.8), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  const door = { x0: 5, x1: ENDBOX.w - 5, y0: 12, y1: ENDBOX.h - 9 };
  out.push(
    `<g transform="${onFaceY(ENDBOX.y + ENDBOX.d, ENDBOX.x, ENDBOX.h)}">${L(rect(door.x0, door.y0, door.x1, door.y1, 1.4), { tone: "lo" })}${L(rect(door.x1 - 7, 22, door.x1 - 4.4, 32, 1), { tone: "mid" })}${L(rect(door.x0 + 5, door.y0 + 5, door.x0 + 21, door.y0 + 9, 0.6), { tone: "faint" })}</g>`,
  );
  out.push(D([at([ENDBOX.x + door.x0 + 3, ENDBOX.y + ENDBOX.d, ENDBOX.h - 17]), at([ENDBOX.x + door.x0 + 3, ENDBOX.y + ENDBOX.d, ENDBOX.h - 37])], { size: 0.55, tone: "mid" }));
  const slots = Array.from({ length: 9 }, (_, i) => rect(8 + i * 3.6, 12, 9.6 + i * 3.6, 30, 0.8, 2)).join("");
  out.push(`<g transform="${onFaceX(ENDBOX.x + ENDBOX.w, ENDBOX.y + ENDBOX.d, ENDBOX.h)}">${L(slots, { tone: "faint" })}</g>`);
  out.push(S(k.slabOf(k.insetPlan(ENDBOX, -1.4), ENDBOX.h, 3, P, 4, 0.6), { tone: "mid" }));
  out.push(
    D(
      k.corners(k.insetPlan(ENDBOX, -1.4), 3).map(([x, y]) => at([x, y, ENDBOX.h + 3])),
      { size: 0.5, tone: "mid" },
    ),
  );
  out.push(D([at([ENDBOX.x + ENDBOX.w, ENDBOX.y + 8, 10])], { size: 0.8, tone: "hi" }));
  return out.join("");
}

const TERM_ASK = [
  [10, "> ship it", "lo"],
  [20, "* Bash(git push)", "mid"],
];
const TERM_BOX = [
  [35, "Bash command", "mid"],
  [45, "  git push", "hi"],
  [58, "Do you want to proceed?", "mid"],
  [68, "> 1. Yes", "hi", ' data-part="yes"'],
  [77, "  2. No", "mid"],
];
const TERM_DONE = [
  [30, "  main -> main", "mid"],
  [42, "* Pushed main to origin.", "mid"],
];

function monitor() {
  const out = [];
  const foot = { x: -292, y: MON.y - 22, w: 72, d: 50, r: 10 };
  out.push(halo(foot, 0, 4));
  out.push(S(k.slabOf(foot, 0, 3.2, P, 8, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(foot, 4), 3.2, P, 8), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -268, y: MON.y - 9, w: 22, d: 9, r: 2.6 }, 3.2, 62, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline({ x: -262, y: MON.y - 6.8, w: 10, d: 4.6, r: 2.2 }, 3.2, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf({ x: MON.x, y: MON.y, w: MON.w, d: MON.d, r: 2.4 }, MON.z, MON.h, P, 4, 0.6), { tone: "mid" }));
  const face = MON.y + MON.d;
  const win = { x0: 6, x1: MON.w - 6, y0: 6, y1: MON.h - 12 };
  const t = (rows, attr) => `<g${attr}>${rows.map(([y, value, tone, extra = ""]) => text(12, win.y0 + y, value, { size: 6, tone, cls: "pm-mono", attrs: extra })).join("")}</g>`;
  const box = `<path class="iso-line" data-tone="lo" d="${rect(9, win.y0 + 26, win.x1 - 4, win.y1 - 4, 2)}"/>`;
  const screen = [
    `<path class="pm-glass" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
    t(TERM_ASK, ""),
    `<g data-term="ask">${box}${t(TERM_BOX, "")}</g>`,
    `<g data-term="done" opacity="0">${t(TERM_DONE, "")}</g>`,
    `<path class="iso-line" data-tone="faint" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
  ];
  out.push(`<g transform="${onFaceY(face, MON.x, MON.z + MON.h)}">${screen.join("")}</g>`);
  out.push(D([at([MON.x + MON.w - 10, face, MON.z + 5.6])], { size: 0.75, tone: "hi" }));
  const side = MON.x + MON.w;
  out.push(S(k.slabOf({ x: side, y: MON.y + 1.2, w: 2.2, d: 4.6, r: 0.8 }, PORT_MON[2] - 2.6, 5.2, P, 2), { tone: "lo" }));
  for (const z of [MON.z + 30, MON.z + 38, MON.z + 46]) out.push(S(k.slabOf({ x: side, y: MON.y + 2.2, w: 0.9, d: 2.6, r: 0.6 }, z, 4, P, 2), { tone: "mid" }));
  return out.join("");
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
  out.push(S(xDisc(LAP.x + 12, LAP.x + LAP.w - 12, LID.o[1], LID.o[2], 2.4), { tone: "lo" }));
  const F = G.frameOf(LID.o, LID.n, [1, 0, 0], LID.up);
  const lid = G.prismOf(F, k.roundedPlan({ x: 0, y: 0, w: LAP.w, d: LAP.lid, r: 5 }, 5), -LAP.lidT, 0, P);
  out.push(S(lid, { tone: "mid" }));
  const corner = G.add3(LID.o, G.mul3(LID.up, LAP.lid));
  const plane = planeMatrix(corner, [1, 0, 0], G.mul3(LID.up, -1));
  const win = { x0: 6, x1: LAP.w - 6, y0: 6, y1: LAP.lid - 10 };
  const card = { x0: 40, y0: 22, x1: 126, y1: 68 };
  const app = [
    `<path class="pm-glass" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
    `<path class="iso-line" data-tone="faint" d="M34 ${win.y0}V${win.y1}"/>`,
    ...["# general", "# app", "# docs", "# infra"].map((name, i) => text(10, 16 + i * 8.5, name, { size: 4, tone: i === 1 ? "hi" : "lo", cls: "pm-sans" })),
    text(40, 16, "Needs you", { size: 5.4, tone: "hi", cls: "pm-sans" }),
    `<g data-app="card">`,
    `<path class="iso-line" data-tone="lo" d="${rect(card.x0, card.y0, card.x1, card.y1, 2.5)}"/>`,
    text(45, 31, "claude · ~/app", { size: 4.2, tone: "lo", cls: "pm-sans" }),
    text(45, 41, "git push", { size: 5.6, tone: "hi", cls: "pm-mono" }),
    `<g data-app="ask">`,
    `<g data-part="allow"><path class="pm-button" d="${rect(45, 50, 84, 61, 2)}"/>${text(64.5, 57.6, "Allow once", { size: 4.4, tone: "hi", cls: "pm-sans", anchor: "middle" })}</g>`,
    `<path class="iso-line" data-tone="lo" d="${rect(88, 50, 114, 61, 2)}"/>${text(101, 57.6, "Deny", { size: 4.4, tone: "mid", cls: "pm-sans", anchor: "middle" })}`,
    `</g>`,
    `<g data-app="done" opacity="0">${text(45, 57.6, "allowed by you", { size: 4.4, tone: "mid", cls: "pm-sans" })}</g>`,
    `<g data-app="elsewhere" opacity="0">${text(45, 57.6, "answered in the terminal", { size: 4.4, tone: "mid", cls: "pm-sans" })}</g>`,
    `</g>`,
    `<path class="pm-cursor" data-part="cursor" d="M0 0L0 8.6L2.2 6.6L3.8 10.2L5.2 9.6L3.6 6.1L6.6 6.1Z" transform="translate(96 72)"/>`,
    `<path class="iso-line" data-tone="faint" d="${rect(win.x0, win.y0, win.x1, win.y1, 1.5)}"/>`,
  ];
  out.push(`<g transform="${plane}">${app.join("")}</g>`);
  return out.join("");
}

function cable(route, keep) {
  const pieces = tubePieces(route, 1.1, P, { maxLength: 24, breaks: [12] });
  return pieces
    .filter((piece) => keep(piece))
    .map((piece) => tubeSvg(piece, { tone: "mid" }))
    .join("");
}

const STYLE = `<style>
[data-figure="permission"] .pm-glass{fill:var(--anatomy-shade-0)}
[data-figure="permission"] .pm-label{fill:var(--anatomy-top);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="permission"] .pm-button{fill:var(--anatomy-top);stroke:var(--anatomy-mid);stroke-width:var(--anatomy-weight)}
[data-figure="permission"] .pm-cursor{fill:var(--anatomy-hi);stroke:var(--anatomy-paper);stroke-width:var(--anatomy-weight)}
[data-figure="permission"] .pm-pulse{fill:none;stroke:var(--anatomy-lit);stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round}
[data-figure="permission"] [data-part="allow"][data-on] .pm-button{fill:var(--anatomy-lit);stroke:var(--anatomy-lit)}
[data-figure="permission"] [data-part="allow"][data-on] text{fill:var(--anatomy-paper)}
[data-figure="permission"] [data-part="yes"][data-on]{fill:var(--anatomy-lit)}
[data-figure="permission"] .pm-mono{font-family:var(--anatomy-mono);letter-spacing:0}
[data-figure="permission"] .pm-sans{font-family:var(--sans,system-ui);letter-spacing:0}
</style>`;

export default function figure() {
  const nearLaptop = (piece) => piece.to <= 12.5;
  const body = [
    STYLE,
    cable(LAP_ROUTE, nearLaptop),
    laptop(),
    rest(),
    conveyorBack(),
    `<g data-slot="a"><g data-part="box">${parcel(TRAVEL.wait)}</g></g>`,
    conveyorFront(),
    armSvg(),
    `<g data-slot="b"></g>`,
    endBox(),
    cable(LAP_ROUTE, (piece) => !nearLaptop(piece)),
    `<path class="pm-pulse" data-part="pulse" d=""/>`,
    monitor(),
    cable(MON_ROUTE, () => true),
    `<path class="pm-pulse" data-part="pulse-mon" d=""/>`,
    cabinet(),
  ];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A desk monitor running Claude Code asks whether it may run git push. A laptop running the Channels app shows the same question in Needs you, with Allow once and Deny. Both are wired to one barrier across a small roller conveyor, where a parcel labelled git push waits. Pressing Allow once on the laptop clears the terminal's prompt by itself, lifts the barrier for that one parcel, and lowers it again behind it. On the next pass the question is answered at the terminal instead: the app's card says it was answered in the terminal, and the same barrier lifts once. Whichever side answers first wins.",
    body,
  });
}
