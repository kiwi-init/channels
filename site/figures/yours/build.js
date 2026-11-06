import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import {
  W,
  H,
  LAP,
  FEET,
  BASE,
  TOP,
  LID,
  LID_UP,
  LID_OUT,
  LID_O,
  DISPLAY,
  DW,
  DH,
  KEY_ROWS,
  SWAP,
  keyPlan,
  BOX,
  WALL,
  BOX_FLOOR,
  INNER,
  MID_Y,
  DIVIDER,
  CLIP,
  DIVIDERS,
  clipY,
  CARD,
  CARDS,
  slotAt,
  cardPaths,
  cardFace,
  P,
  planeMatrix,
  lidPoint,
  SCREEN,
  AREA,
  areasOf,
  BUTTON,
  CURSOR_REST,
  TRAY,
  TRAY_H,
} from "./model.js";

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const at = (point) => k.iso(point, P);
const halo = (plan, z, h) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (x, y, w, h, r = 0, steps = 4) => k.pathOf(k.roundedPlan({ x, y, w, d: h, r }, steps), true);
const onPlane = (matrix, inner) => `<g transform="${matrix}">${inner}</g>`;
const printed = (x, y, value, size, tone = "mid", anchor = "start") => `<text class="iso-face-text" data-tone="${tone}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${value}</text>`;
const say = (x, y, value, size, tone = "ink", extra = "") => `<text class="yo-t" data-tone="${tone}" x="${x}" y="${y}" font-size="${size}"${extra}>${value}</text>`;

const STYLE = `<style>
[data-figure="yours"] .yo-screen{--yo-glass:var(--anatomy-shade-0);--yo-ink:var(--anatomy-hi);--yo-ink2:var(--anatomy-mid);--yo-rule:var(--anatomy-faint);--yo-acc:var(--anatomy-mid)}
[data-figure="yours"] .yo-screen[data-themed]{--yo-glass:var(--anatomy-hi);--yo-ink:var(--anatomy-face);--yo-ink2:var(--anatomy-faint);--yo-rule:var(--anatomy-lo);--yo-acc:var(--anatomy-faint)}
[data-figure="yours"] .yo-screen[data-themed][data-lit]{--yo-acc:var(--anatomy-lit)}
[data-figure="yours"] .yo-glass{fill:var(--yo-glass)}
[data-figure="yours"] .yo-pane{fill:var(--yo-ink)}
[data-figure="yours"] .yo-rule{fill:var(--yo-rule)}
[data-figure="yours"] .yo-acc{fill:var(--yo-acc)}
[data-figure="yours"] .yo-t{font-family:var(--anatomy-mono);fill:var(--yo-ink);letter-spacing:.02em}
[data-figure="yours"] .yo-t[data-tone="lo"]{fill:var(--yo-ink2)}
[data-figure="yours"] .yo-icon{fill:none;stroke:var(--yo-ink2);stroke-width:.5px}
[data-figure="yours"] .yo-dot{fill:var(--yo-ink2)}
[data-figure="yours"] .yo-box{fill:none;stroke:var(--yo-rule);stroke-width:.5px}
[data-figure="yours"] .yo-frame{fill:none;stroke:none;stroke-width:var(--anatomy-weight)}
[data-figure="yours"] .yo-frame[data-lit]{stroke:var(--anatomy-lit)}
[data-figure="yours"] .yo-edge{fill:none;stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
[data-figure="yours"] .yo-screen[data-lit] .yo-edge{stroke:var(--anatomy-lit)}
[data-figure="yours"] .yo-btn{fill:var(--yo-ink)}
[data-figure="yours"] .yo-btn[data-lit]{fill:var(--anatomy-lit)}
[data-figure="yours"] .yo-btn-t{font-family:var(--anatomy-mono);fill:var(--yo-glass)}
[data-figure="yours"] .yo-cursor{fill:var(--yo-ink);stroke:var(--yo-glass);stroke-width:.5px;stroke-linejoin:round}
[data-figure="yours"] .yo-socket{fill:var(--anatomy-shade-0)}
[data-figure="yours"] .yo-sw[data-k="bg"]{fill:var(--anatomy-hi)}
[data-figure="yours"] .yo-sw[data-k="ink"]{fill:var(--anatomy-face);stroke:var(--anatomy-lo);stroke-width:.4px}
[data-figure="yours"] .yo-sw[data-k="acc"]{fill:var(--anatomy-mid)}
[data-figure="yours"] [data-lit] .yo-sw[data-k="acc"]{fill:var(--anatomy-lit)}
[data-figure="yours"] [data-lit] .yo-print{fill:var(--anatomy-lit)}
</style>`;

function frontSlot(y, x0, x1, z0, z1, r) {
  return k.pathOf(
    k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4).map(([x, z]) => at([x, y, z])),
    true,
  );
}

function keys() {
  const out = [];
  KEY_ROWS.forEach((row, r) =>
    row.forEach((_, c) => {
      if (r === SWAP.row && c === SWAP.col) return;
      out.push(S(k.slabOf(keyPlan(r, c), TOP, 0.8, P, 2), { tone: "mid", crease: "faint" }));
    }),
  );
  return out.join("");
}

function swapKeys() {
  const plan = keyPlan(SWAP.row, SWAP.col);
  const well = S(k.slabOf(k.insetPlan(plan, 0.6), TOP - 0.01, 0.01, P, 2), { tone: "lo", flat: true, crease: "none" });
  const old = S(k.slabOf(plan, TOP, 0.8, P, 2), { tone: "mid", crease: "faint" });
  const cx = plan.x + plan.w / 2;
  const cy = plan.y + plan.d / 2;
  const fresh = S(k.slabOf(plan, TOP, 0.8, P, 2), { tone: "hi", crease: "lo", inner: L(k.ring(cx, cy, 1.6, TOP + 0.8, P, 16), { tone: "lo" }) });
  return `${well}<g data-part="key-old" opacity="0">${old}</g><g data-part="key-new">${fresh}</g>`;
}

function screen() {
  const clip = "yo-display";
  const shape = rect(0, 0, DW, DH, 2.4);
  const A = areasOf(true, true);
  const rows = ["general", "design", "ship", "docs"];
  const top = AREA.top;
  const rail = [
    `<rect class="yo-glass" x="0" y="${top}" width="${AREA.rail}" height="${DH - top}"/>`,
    `<rect class="yo-pane" x="0" y="${top}" width="${AREA.rail}" height="${DH - top}" fill-opacity=".1"/>`,
    ...[0, 1, 2].map((i) => `<rect class="${i === 0 ? "yo-acc" : "yo-icon"}" x="2" y="${top + 4 + i * 8}" width="6" height="6" rx="1.6"/>`),
    `<rect class="yo-icon" x="2" y="${DH - 10}" width="6" height="6" rx="3"/>`,
  ];
  const side = [
    `<rect class="yo-glass" x="0" y="${top}" width="${AREA.side}" height="${DH - top}"/>`,
    `<rect class="yo-pane" x="0" y="${top}" width="${AREA.side}" height="${DH - top}" fill-opacity=".06"/>`,
    say(3, top + 6.4, "channels", 3, "lo"),
    `<rect class="yo-pane" x="1.5" y="${top + 9.4}" width="${AREA.side - 3}" height="6" rx="1.2" fill-opacity=".1"/>`,
    `<rect class="yo-acc" x="1.5" y="${top + 9.4}" width="1.2" height="6" rx=".6"/>`,
    ...rows.map((name, i) => say(4.4, top + 13.8 + i * 7, `# ${name}`, 3.6, i === 0 ? "ink" : "lo")),
    `<rect class="yo-frame" data-part="side-frame" x=".6" y="${top + 0.6}" width="${AREA.side - 1.2}" height="${DH - top - 1.2}" rx="1"/>`,
  ];
  const chat = [
    say(5, top + 7, "# general", 4.2),
    `<rect class="yo-rule" data-part="chat-rule" x="0" y="${top + 10}" width="${A.chatW}" height=".4"/>`,
    `<circle class="yo-dot" cx="6" cy="${top + 17}" r="2.4"/>`,
    say(10.4, top + 16.2, "maya", 3.2, "lo"),
    say(10.4, top + 21, "new theme?", 3.6),
    `<circle class="yo-dot" cx="6" cy="${top + 30}" r="2.4"/>`,
    say(10.4, top + 29.2, "claude", 3.2, "lo"),
    say(10.4, top + 34, "saved, live", 3.6),
    `<rect class="yo-box" data-part="composer" x="4" y="${DH - 11}" width="${A.chatW - 8}" height="7" rx="1.6"/>`,
    say(7, DH - 6.4, "Message", 3.2, "lo"),
  ];
  const needs = [
    ["panel", `<rect class="yo-icon" x="4" y="${top + 19}" width="4" height="3.4" rx=".6"/><path class="yo-icon" d="M6.4 ${top + 19}V${top + 22.4}"/>`],
    ["⌘K", `<rect class="yo-icon" x="4" y="${top + 25}" width="4" height="3.4" rx=".8"/>`],
    ["api.linear.app", `<circle class="yo-icon" cx="6" cy="${top + 32.7}" r="1.9"/><path class="yo-icon" d="M4.1 ${top + 32.7}H7.9"/>`],
  ];
  const ask = [
    say(4, top + 14.6, "asks for", 3, "lo"),
    ...needs.map(([word, icon], i) => icon + say(10, top + 22 + i * 6, word, 3)),
    `<rect class="yo-btn" data-part="button" x="${BUTTON.u}" y="${BUTTON.v}" width="${BUTTON.w}" height="${BUTTON.h}" rx="1.6"/>`,
    `<text class="yo-btn-t" x="${BUTTON.u + BUTTON.w / 2}" y="${BUTTON.v + 4.8}" font-size="3.2" text-anchor="middle">Turn on</text>`,
  ];
  const issues = ["LIN-42", "LIN-39", "LIN-37", "LIN-31"];
  const on = [
    ...issues.map(
      (id, i) =>
        `<circle class="${i === 0 ? "yo-acc" : "yo-icon"}" cx="6" cy="${top + 15 + i * 9}" r="1.7"/>` +
        say(10, top + 16.2 + i * 9, id, 3.2) +
        `<rect class="yo-rule" x="10" y="${top + 18.8 + i * 9}" width="${[22, 16, 19, 13][i]}" height=".7" rx=".35"/>`,
    ),
  ];
  const panel = [
    `<rect class="yo-glass" x="0" y="${top}" width="${AREA.panel}" height="${DH - top}"/>`,
    `<rect class="yo-pane" x="0" y="${top}" width="${AREA.panel}" height="${DH - top}" fill-opacity=".06"/>`,
    `<rect class="yo-rule" x="${AREA.panel - 0.4}" y="${top}" width=".4" height="${DH - top}"/>`,
    say(4, top + 7, "linear", 4.2),
    say(22, top + 7, "mod", 3, "lo"),
    `<g data-part="ask" display="none">${ask.join("")}</g>`,
    `<g data-part="on">${on.join("")}</g>`,
    `<rect class="yo-frame" data-part="panel-frame" x=".6" y="${top + 0.6}" width="${AREA.panel - 1.2}" height="${DH - top - 1.2}" rx="1"/>`,
  ];
  const cursor = `<g data-part="cursor" transform="translate(${CURSOR_REST[0]} ${CURSOR_REST[1]})"><path class="yo-cursor" d="M0 0V8.6L2.2 6.6L3.7 10L5.3 9.3L3.8 6H6.9Z"/></g>`;
  const inner = [
    `<clipPath id="${clip}"><path d="${shape}"/></clipPath>`,
    `<path class="yo-glass" d="${shape}"/>`,
    `<g clip-path="url(#${clip})">`,
    `<rect class="yo-rule" x="0" y="${top - 0.4}" width="${DW}" height=".4"/>`,
    ...[0, 1, 2].map((i) => `<circle class="yo-dot" cx="${4 + i * 4.2}" cy="3.5" r="1.1"/>`),
    `<g data-area="chat" transform="translate(${A.chat} 0)">${chat.join("")}</g>`,
    `<g data-area="panel" transform="translate(${A.panel} 0)">${panel.join("")}</g>`,
    `<g data-area="side" transform="translate(${A.side} 0)">${side.join("")}</g>`,
    `<g data-area="rail" transform="translate(${A.rail} 0)">${rail.join("")}</g>`,
    cursor,
    `</g>`,
    `<path class="yo-edge" d="${shape}"/>`,
  ];
  return `<g class="yo-screen" data-part="screen" data-themed data-lit transform="${SCREEN}">${inner.join("")}</g>`;
}

function laptop() {
  const plan = { x: LAP.x, y: LAP.y, w: BASE.w, d: BASE.d, r: 6 };
  const out = [halo(plan, 0, BASE.h + FEET)];
  for (const [x, y] of byDepth(k.corners(plan, 10))) out.push(S(k.cylinder(x, y, 3, 0, FEET, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf(plan, BASE.z, BASE.h, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, BASE.z + 2, P, 6), { tone: "faint" }) }));
  const y = LAP.y + BASE.d;
  const z0 = BASE.z + 2.2;
  const z1 = BASE.z + 4.4;
  out.push(
    L([frontSlot(y, LAP.x + 14, LAP.x + 22, z0, z1, 1.1), frontSlot(y, LAP.x + 26, LAP.x + 34, z0, z1, 1.1), frontSlot(y, LAP.x + 42, LAP.x + 46, z0 + 0.2, z1 - 0.2, 1)].join(""), { tone: "lo" }),
  );
  out.push(D([at([LAP.x + 80, y, BASE.z + 3.3])], { size: 0.7, tone: "hi" }));
  const front = planeMatrix([LAP.x + BASE.w, LAP.y + BASE.d, TOP], [0, -1, 0], [0, 0, -1]);
  const scoop = k.pathOf(Array.from({ length: 17 }, (_, i) => at([LAP.x + BASE.w, LAP.y + BASE.d / 2 - 14 + i * 1.75, TOP - 0.2 - Math.sin((i / 16) * Math.PI) * 2.4])));
  out.push(onPlane(front, D([[BASE.d - 14, 3.2]], { size: 0.5, tone: "lo" })));
  out.push(L(scoop, { tone: "lo" }));
  out.push(L(k.planOutline({ x: LAP.x + 10.5, y: LAP.y + 9.6, w: 46, d: 120.8, r: 2 }, TOP, P, 4), { tone: "faint" }));
  out.push([LAP.y + 3.4, LAP.y + BASE.d - 6.4].map((yy) => D(k.dotGrid(LAP.x + 12, yy, 12, 3, 1.5, TOP, P), { size: 0.32, tone: "lo" })).join(""));
  out.push(keys());
  out.push(swapKeys());
  out.push(L(k.planOutline({ x: LAP.x + 62, y: LAP.y + 44, w: 26, d: 52, r: 3 }, TOP, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline({ x: LAP.x + 63.2, y: LAP.y + 45.2, w: 23.6, d: 49.6, r: 2.2 }, TOP, P, 4), { tone: "faint" }));
  const hinge = G.frameAlong([LAP.x + 4, LID_O[1], TOP + 2.2], [0, 1, 0]);
  out.push(S(G.disc(-58, 58, 2.2, hinge, P), { tone: "mid" }));
  const F = G.frameOf(LID_O, LID_OUT, [0, -1, 0], LID_UP);
  const outline = k.roundedPlan({ x: -LID.w / 2, y: 0, w: LID.w, d: LID.h, r: 6 }, 6);
  out.push(S(G.prismOf(F, outline, -LID.t, 0, P), { tone: "mid" }));
  const camera = lidPoint(0, LID.h - DISPLAY.top / 2, 0.05);
  out.push(L(G.circleOf(G.frameAlong(camera, LID_OUT), 0, 1.1, P, 16), { tone: "lo" }));
  out.push(D([at(lidPoint(0, DISPLAY.bottom / 2, 0.05))], { size: 0.45, tone: "faint" }));
  out.push(screen());
  return out.join("");
}

function wall(plan, inner) {
  return S(k.slabOf(plan, 0, WALL.h, P, 2, 0.5), { tone: "mid", inner });
}

function corner(x, y) {
  const plan = { x, y, w: 3.8, d: 3.8, r: 0.9 };
  const cx = x + 1.9;
  const cy = y + 1.9;
  const rivets = [3, WALL.h - 2.6].flatMap((z) => [at([x + 3.8, cy, z]), at([cx, y + 3.8, z])]);
  return S(k.slabOf(plan, 0, WALL.h + 0.3, P, 3, 0.3), { tone: "hi", crease: "lo" }) + D(rivets, { size: 0.42, tone: "mid" });
}

function divider(d) {
  const out = [];
  const body = { x: d.x, y: INNER.y0 + 0.4, w: DIVIDER.t, d: INNER.y1 - INNER.y0 - 0.8, r: 0.3 };
  out.push(S(k.slabOf(body, BOX_FLOOR, DIVIDER.h, P, 2), { tone: "hi", crease: "lo" }));
  const board = planeMatrix([d.x + DIVIDER.t + 0.02, body.y + body.d, BOX_FLOOR + DIVIDER.h], [0, -1, 0], [0, 0, -1]);
  out.push(onPlane(board, L(rect(2, 2, body.d - 4, DIVIDER.h - 4, 1.2), { tone: "faint" })));
  const y0 = clipY(d.side);
  const z0 = BOX_FLOOR + DIVIDER.h - CLIP.below;
  const clip = { x: d.x - 0.7, y: y0, w: CLIP.t, d: CLIP.w, r: 0.7 };
  out.push(S(k.slabOf(clip, z0, CLIP.h, P, 2, 0.3), { tone: "mid" }));
  const face = planeMatrix([clip.x + CLIP.t + 0.02, y0 + CLIP.w, z0 + CLIP.h], [0, -1, 0], [0, 0, -1]);
  out.push(
    onPlane(
      face,
      `<path class="yo-socket" d="${rect(1.4, 1.6, CLIP.w - 2.8, 7.4, 0.8)}"/>` + L(rect(1.4, 1.6, CLIP.w - 2.8, 7.4, 0.8), { tone: "lo" }) + printed(CLIP.w / 2, 7.1, d.name, 4.8, "hi", "middle"),
    ),
  );
  return out.join("");
}

function cardFaceSvg(card) {
  const out = [printed(2.6, 5.8, card.name, 4.2, "hi"), L(`M0 8.2H${CARD.w}`, { tone: "faint" })];
  if (card.kind === "theme") {
    out.push(`<rect class="yo-sw" data-k="bg" x="2.8" y="10.6" width="9.4" height="8.8" rx=".8"/>`);
    out.push(`<rect class="yo-sw" data-k="ink" x="13.3" y="10.6" width="9.4" height="8.8" rx=".8"/>`);
    out.push(`<rect class="yo-sw" data-k="acc" x="23.8" y="10.6" width="9.4" height="8.8" rx=".8"/>`);
  } else if (card.kind === "keys") {
    out.push(L(rect(3.4, 10.4, 9.6, 9.2, 1.6) + rect(15.4, 10.4, 9.6, 9.2, 1.6), { tone: "mid" }));
    out.push(`<text class="iso-face-text yo-print" data-tone="hi" x="8.2" y="17" font-size="5.2" text-anchor="middle">⌘</text>`);
    out.push(`<text class="iso-face-text yo-print" data-tone="hi" x="20.2" y="17" font-size="5.2" text-anchor="middle">P</text>`);
  } else if (card.kind === "layout") {
    out.push(L(rect(2.8, 10.4, 30.4, 9.4, 1.2) + `M21 10.4V19.8M29.4 10.4V19.8`, { tone: "mid" }));
    out.push(`<rect class="yo-sw" data-k="acc" x="21.5" y="10.9" width="7.4" height="8.4"/>`);
  } else {
    out.push(printed(2.6, 13.8, "panel  ⌘K", 3.6, "mid"));
    out.push(printed(2.6, 18.8, "api.linear.app", 3.6, "mid"));
  }
  return out.join("");
}

function cardSvg(card, i, o, theta) {
  const paths = cardPaths(o, theta);
  const parts = [
    `<path class="iso-fill" data-c="fill" d="${paths.fill}"/>`,
    ...paths.shades.map((d, s) => `<path class="iso-shade" data-shade="${s}" data-c="s${s}" d="${d}"/>`),
    `<path class="iso-top" data-c="top" d="${paths.top}"/>`,
    `<path class="iso-line iso-crease" data-tone="faint" data-c="crease" d="${paths.crease}"/>`,
    `<g data-c="face" transform="${cardFace(o, theta)}">${cardFaceSvg(card)}</g>`,
    `<path class="iso-line iso-edge" data-tone="hi" data-c="outline" d="${paths.outline}"/>`,
  ];
  return `<g class="iso-solid" data-card="${i}">${parts.join("")}</g>`;
}

function slot(i) {
  return `<g data-slot="${i}">${cardSvg(CARDS[i], i, slotAt(i), Math.PI / 2)}</g>`;
}

function box() {
  const out = [halo(BOX, 0, WALL.h)];
  const t = WALL.t;
  out.push(wall({ x: BOX.x, y: BOX.y, w: t, d: BOX.d, r: 0.6 }));
  out.push(wall({ x: BOX.x + t, y: BOX.y, w: BOX.w - 2 * t, d: t, r: 0.3 }));
  out.push(S(k.slabOf({ x: INNER.x0, y: INNER.y0, w: INNER.x1 - INNER.x0, d: INNER.y1 - INNER.y0, r: 0.3 }, 0, BOX_FLOOR, P, 2), { tone: "lo", crease: "none" }));
  const order = [
    { x: DIVIDERS[0].x, svg: divider(DIVIDERS[0]) },
    { x: DIVIDERS[1].x, svg: divider(DIVIDERS[1]) },
    { x: DIVIDERS[2].x, svg: divider(DIVIDERS[2]) },
    ...CARDS.map((card, i) => ({ x: card.slot, svg: slot(i) })),
  ].sort((a, b) => a.x - b.x);
  out.push(order.map((part) => part.svg).join(""));
  const near = { x: BOX.x + t, y: BOX.y + BOX.d - t, w: BOX.w - 2 * t, d: t, r: 0.3 };
  out.push(wall(near));
  const side = planeMatrix([BOX.x + t, BOX.y + BOX.d, WALL.h], [1, 0, 0], [0, 0, -1]);
  const grip = rect((BOX.w - 2 * t) / 2 - 10, 3.8, 20, 5.2, 2.6);
  out.push(onPlane(side, `<path class="yo-socket" d="${grip}"/>` + L(grip, { tone: "lo" })));
  out.push(D([at([BOX.x + t + 4, BOX.y + BOX.d, 3]), at([BOX.x + BOX.w - t - 4, BOX.y + BOX.d, 3])], { size: 0.45, tone: "lo" }));
  out.push(corner(BOX.x - 0.4, BOX.y + BOX.d - 3.4));
  const frontPlan = { x: BOX.x + BOX.w - t, y: BOX.y, w: t, d: BOX.d, r: 0.6 };
  out.push(wall(frontPlan, L(k.sideSeam(frontPlan, 3.2, P, 2), { tone: "faint" })));
  out.push(corner(BOX.x + BOX.w - 3.4, BOX.y - 0.4));
  out.push(corner(BOX.x + BOX.w - 3.4, BOX.y + BOX.d - 3.4));
  const holder = { x: BOX.x + BOX.w, y: MID_Y - 21, w: 0.6, d: 42, r: 0.3 };
  out.push(S(k.slabOf(holder, 5.4, 10.4, P, 2, 0.2), { tone: "mid" }));
  const face = planeMatrix([holder.x + holder.w + 0.02, holder.y + holder.d, 15.8], [0, -1, 0], [0, 0, -1]);
  out.push(onPlane(face, `<path class="yo-socket" d="${rect(3.4, 1.6, 35.2, 7.2, 0.8)}"/>` + L(rect(3.4, 1.6, 35.2, 7.2, 0.8), { tone: "lo" }) + printed(21, 7.1, "~/.kiwi", 5.6, "hi", "middle")));
  out.push(D([at([holder.x + 0.6, holder.y + holder.d - 1.6, 10.6]), at([holder.x + 0.6, holder.y + 1.6, 10.6])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function tray() {
  const out = [halo(TRAY, 0, TRAY_H)];
  out.push(S(k.slabOf(TRAY, 0, TRAY_H, P, 6, 0.6), { tone: "mid", inner: L(k.sideSeam(TRAY, 1.4, P, 6), { tone: "faint" }) }));
  const well = k.insetPlan(TRAY, 3);
  out.push(S(k.slabOf(well, TRAY_H - 0.01, 0.01, P, 6), { tone: "lo", flat: true, crease: "none" }));
  out.push(L(k.planOutline(well, TRAY_H, P, 6), { tone: "lo" }));
  out.push(
    D(
      k.corners(TRAY, 1.5).map(([x, y]) => at([x, y, TRAY_H])),
      { size: 0.45, tone: "lo" },
    ),
  );
  return out.join("");
}

export default function figure() {
  const body = [STYLE, laptop(), box(), tray(), `<g data-part="pile"></g>`];
  return k.figureSvg({
    width: W,
    height: H,
    label:
      "A laptop running the Channels app beside a small file box labelled ~/.kiwi, with dividers for themes, layouts and mods, and a tray of four cards in front of it. The cards go into the box one at a time, and the app changes the moment each one is in: a theme card with three colour swatches turns the screen to its colours, a keys.json card swaps a key on the keyboard, a layout card moves the sidebar from the left of the chat to the right, and a mod card named linear opens a panel beside the chat that first lists what it asks for, a panel, a command and one host, and opens once the cursor turns it on. When the cards go back to the tray, the app is exactly as it is by default.",
    body,
  });
}
