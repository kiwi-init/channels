import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import * as M from "./model.js";

const { P, at } = M;
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const path = (points, closed = true) => k.pathOf(points.map(at), closed);
const depth = (point) => k.depthOf(point, P);
const byDepth = (list, of = (item) => item) => [...list].sort((a, b) => depth(of(a)) - depth(of(b)));
const rect = (x, y, w, h, r = 0, steps = 4) => k.pathOf(k.roundedPlan({ x, y, w, d: h, r }, steps), true);

function onFace(face, u, z) {
  return face.axis === "y" ? [u, face.at, z] : [face.at, -u, z];
}

function faceRect(face, u, z, w, h, r = 0.8, steps = 3) {
  return path(k.roundedPlan({ x: u - w / 2, y: z - h / 2, w, d: h, r }, steps).map(([a, b]) => onFace(face, a, b)));
}

function faceRing(face, u, z, radius, steps = 20) {
  return path(Array.from({ length: steps }, (_, i) => onFace(face, u + radius * Math.cos((i / steps) * Math.PI * 2), z + radius * Math.sin((i / steps) * Math.PI * 2))));
}

function slots(face, from, to, z0, z1, count, width = 1.6) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = from + ((to - from) * (i + 0.5)) / count;
    out.push(faceRect(face, u, (z0 + z1) / 2, width, z1 - z0, width / 2, 2));
  }
  return out.join("");
}

function screws(points, z, size = 1.6) {
  return (
    L(points.map(([x, y]) => k.ring(x, y, size, z, P, 14)).join(""), { tone: "lo" }) +
    D(
      points.map(([x, y]) => at([x, y, z])),
      { size: 0.45 },
    )
  );
}

function text(x, y, em, tone, content, extra = "") {
  const safe = String(content).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<text class="iso-face-text" data-tone="${tone}" x="${x}" y="${y}" font-size="${em}"${extra}>${safe}</text>`;
}

const clips = [];
function clipOf(id, matrix, d) {
  clips.push(`<clipPath id="${id}"><path transform="${matrix}" d="${d}"/></clipPath>`);
  return `url(#${id})`;
}

function feedSvg(name) {
  const layout = M.LAYOUT[name];
  const screen = M.SCREENS[name];
  const rows = M.feedState(name, M.STILL);
  const [cx, cy, cw, ch] = layout.clip;
  const clip = clipOf(`relay-feed-${name}`, screen.matrix, rect(cx, cy, cw, ch));
  const slotsSvg = Array.from({ length: layout.cap + 4 }, (_, i) => {
    const row = rows[i];
    const style = row && row.opacity < 1 ? ` opacity="${row.opacity.toFixed(2)}"` : "";
    return text(layout.x, row ? row.y.toFixed(2) : 0, layout.em, row ? row.tone : "hi", row ? row.text : "", ` data-row="${i}"${style}`);
  }).join("");
  return `<g clip-path="${clip}"><g transform="${screen.matrix}" data-feed="${name}">${slotsSvg}</g></g>`;
}

function composeSvg(name) {
  const layout = M.LAYOUT[name];
  if (!layout.compose) return "";
  const state = M.composeState(name, M.STILL);
  const { x, y, em } = layout.compose;
  const caretX = x + state.text.length * em * 0.64 + 0.6;
  return (
    text(x, y, em, "hi", state.text, ` data-compose="${name}"`) +
    `<path class="iso-line" data-tone="hi" data-caret="${name}" data-free="" d="M${caretX.toFixed(1)} ${y - em * 0.78}V${y + 0.8}"${state.caret ? "" : ' opacity="0"'}/>`
  );
}

function screenSvg(name, chrome) {
  const screen = M.SCREENS[name];
  const glass = rect(0, 0, screen.w, screen.h, 1.6);
  const clip = clipOf(`relay-screen-${name}`, screen.matrix, glass);
  return [
    `<g transform="${screen.matrix}"><path class="iso-fill" d="${glass}"/></g>`,
    `<g clip-path="${clip}"><g transform="${screen.matrix}">${chrome}${composeSvg(name)}</g>${feedSvg(name)}</g>`,
    `<g transform="${screen.matrix}"><path class="iso-line" data-tone="lo" d="${glass}"/></g>`,
  ].join("");
}

const flatLine = (points, tone = "faint") => `<path class="iso-line" data-tone="${tone}" d="${points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")}"/>`;
const flatOutline = (x, y, w, h, r, tone = "lo") => `<path class="iso-line" data-tone="${tone}" d="${rect(x, y, w, h, r)}"/>`;

const CHROME = {
  laptop: () => {
    const icons = [0, 1, 2, 3].map((i) => flatOutline(5, 5 + i * 11, 10, 8, 2, i === 0 ? "hi" : "lo")).join("");
    const compose = M.LAYOUT.laptop.compose.box;
    return [
      flatLine([
        [20, 0],
        [20, 76],
      ]),
      flatLine([
        [20, 12.5],
        [128, 12.5],
      ]),
      icons,
      text(26, 9, 6.2, "mid", "# release"),
      flatOutline(...compose, 2, "lo"),
    ].join("");
  },
  phone: () =>
    [
      flatLine([
        [0, 8.5],
        [34, 8.5],
      ]),
      text(3, 6.4, 3.6, "mid", "# release"),
      flatOutline(...M.LAYOUT.phone.compose.box, 1.6, "lo"),
    ].join(""),
  claude: () => [flatOutline(3, 3, 76, 12, 1.5, "mid"), text(7, 11.4, 6.2, "mid", "✻ Claude Code"), flatOutline(3, 67, 144, 10, 1.5, "lo"), text(6.5, 74.2, 6.4, "mid", ">")].join(""),
  codex: () =>
    [
      flatOutline(3, 3, 54, 12, 1.5, "mid"),
      text(7, 11.4, 6.2, "mid", ">_ codex"),
      flatLine([
        [0, 64.5],
        [128, 64.5],
      ]),
      text(5.5, 72, 6.4, "mid", "›"),
    ].join(""),
  relay: () => "",
};

const FEET = [
  [-226, -246],
  [-196, 222],
  [140, -214],
  [96, 176],
];

function bench() {
  const ring = M.benchRing();
  const out = [`<path class="iso-halo" d="${k.extrude(ring, -M.BENCH_T - M.FOOT_H, M.BENCH_T, P).fill}"/>`];
  for (const [x, y] of byDepth(FEET, ([x, y]) => [x, y, 0])) {
    out.push(S(k.cylinder(x, y, 9, -M.BENCH_T - M.FOOT_H, 2, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 7, -M.BENCH_T - M.FOOT_H + 2, M.FOOT_H - 2, P, 28), { tone: "lo" }));
  }
  out.push(S(k.extrude(ring, -M.BENCH_T, M.BENCH_T, P, { bevel: 1.6 }), { tone: "lo", inner: L(k.ringSeam(ring, -M.BENCH_T + 3, P), { tone: "faint" }) }));
  out.push(L(k.onTop(M.benchRing(8), 0, P, true), { tone: "faint" }));
  out.push(screws(FEET, 0, 2.4));
  const label = { x: 84, y: 184, w: 40, d: 12, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  out.push(L([28, 20, 24].map((w, i) => k.lineOnTop([label.x + 4, label.y + 3 + i * 3], [label.x + 4 + w, label.y + 3 + i * 3], 0.6, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3.5, label.y + 3, 0.6]), at([label.x + label.w - 3.5, label.y + label.d - 3, 0.6])], { size: 0.45 }));
  return out.join("");
}

function laptop(device, name) {
  const { F, w, d, z0, z1, lid } = device;
  const deck = M.planIn(F, { w0: -w / 2, w1: w / 2, d0: -d / 2, d1: d / 2, r: 6 });
  const out = [`<path class="iso-halo" d="${k.haloOf(deck, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(k.insetPlan(deck, 5), 0, z0, P, 6), { tone: "lo" }));
  out.push(S(k.slabOf(deck, z0, z1 - z0, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(deck, z0 + 2.4, P, 6), { tone: "faint" }) }));
  const top = (w0, w1, d0, d1, r, steps = 3) => k.planOutline(M.planIn(F, { w0, w1, d0, d1, r }), z1, P, steps);
  out.push(L(top(-60, 60, -43, -5, 2.4), { tone: "lo" }));
  const keys = [];
  const rows = [
    [13, 1],
    [13, 1],
    [12, 1, 1.5],
    [11, 1, 2],
    [3, 1, 0, 6.5],
  ];
  rows.forEach(([count, , wide = 1, space = 0], r) => {
    const d0 = -41.4 + r * 7.2;
    const pitch = 115 / (count - 1 + wide + (space ? space - 1 : 0));
    let u = -57.5;
    for (let i = 0; i < count; i++) {
      const span = (space && i === 1 ? space : i === count - 1 ? wide : 1) * pitch;
      keys.push(top(u + 0.7, u + span - 0.7, d0 + 0.7, d0 + 6.5, 0.8, 1));
      u += span;
    }
  });
  out.push(L(keys.join(""), { tone: "faint" }));
  out.push(L(top(-26, 26, 4, 38, 3), { tone: "lo" }));
  const grille = [];
  for (const side of [-1, 1]) for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) grille.push(at(M.local(F, [side * (63.5 + j * 2.4), -40 + i * 4.2, z1])));
  out.push(D(grille, { size: 0.42, tone: "lo" }));
  const sideFace = F.t[0] === 1 ? { axis: "y", at: deck.y + deck.d } : { axis: "x", at: deck.x + deck.w };
  const sideU = (dd) => (sideFace.axis === "y" ? M.local(F, [0, dd, 0])[0] : -M.local(F, [0, dd, 0])[1]);
  if (name === "laptop")
    out.push(
      L(
        [
          faceRect(sideFace, sideU(-30), (z0 + z1) / 2 + 0.4, 6.4, 2.2, 1.1),
          faceRect(sideFace, sideU(-21), (z0 + z1) / 2 + 0.4, 6.4, 2.2, 1.1),
          faceRect(sideFace, sideU(-12), (z0 + z1) / 2 + 0.4, 2.4, 2.4, 1.2),
        ].join(""),
        { tone: "lo" },
      ),
    );
  else out.push(L([faceRect(sideFace, sideU(-4), (z0 + z1) / 2 + 0.4, 6.4, 2.2, 1.1), faceRect(sideFace, sideU(5), (z0 + z1) / 2 + 0.4, 2.4, 2.4, 1.2)].join(""), { tone: "lo" }));
  const L0 = M.lidOf(device);
  const frame = G.frameOf(L0.hinge, L0.normal, L0.right, L0.up);
  const shape = k.roundedPlan({ x: -lid.w / 2, y: 0, w: lid.w, d: lid.h, r: 5 }, 5);
  out.push(S(G.prismOf(frame, shape, -lid.t, 0, P), { tone: "mid" }));
  const cam = L0.hinge.map((value, i) => value + L0.up[i] * (lid.h - 3));
  out.push(D([at(cam)], { size: 0.6, tone: "lo" }));
  out.push(screenSvg(name, CHROME[name]()));
  return out.join("");
}

function monitor() {
  const { F, w, h, z0, t } = M.MONITOR;
  const out = [];
  const base = { x: -238, y: -36, w: 60, d: 72, r: 9 };
  out.push(`<path class="iso-halo" d="${k.haloOf(base, 0, 5, P)}"/>`);
  out.push(S(k.slabOf(base, 0, 4.5, P, 8, 0.8), { tone: "mid" }));
  out.push(
    screws(
      [
        [-226, -24],
        [-226, 24],
      ],
      4.5,
      1.4,
    ),
  );
  out.push(S(k.slabOf({ x: -222, y: -10, w: 10, d: 20, r: 3 }, 4.5, 92, P, 4, 0.6), { tone: "mid" }));
  const frame = G.frameOf(M.local(F, [0, 0, 0]), F.t, F.r, [0, 0, 1]);
  const shape = k.roundedPlan({ x: -w / 2, y: z0, w, d: h, r: 4.5 }, 5);
  out.push(S(G.prismOf(frame, shape, -t / 2, t / 2, P), { tone: "mid" }));
  out.push(D([at(M.local(F, [w / 2 - 8, t / 2, z0 + 4.5]))], { size: 0.7, tone: "hi" }));
  out.push(screenSvg("claude", CHROME.claude()));
  return out.join("");
}

function mini() {
  const { x, y, w, d, r, z0, h } = M.MINI;
  const plan = { x, y, w, d, r };
  const front = { axis: "x", at: x + w };
  const side = { axis: "y", at: y + d };
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, 4, P)}"/>`];
  out.push(S(k.slabOf(k.insetPlan(plan, 4), 0, z0, P, 6), { tone: "lo" }));
  out.push(S(k.slabOf(plan, z0, h, P, 8, 1), { tone: "mid", inner: L(k.sideSeam(plan, z0 + 2.2, P, 8), { tone: "faint" }) }));
  out.push(L(k.ring(x + w / 2, y + d / 2, 9, z0 + h, P, 32), { tone: "faint" }));
  out.push(L(slots(front, -y - 36, -y - 14, z0 + 4, z0 + 11, 8, 1.2), { tone: "faint" }));
  out.push(L(slots(side, x + 10, x + 40, z0 + 5, z0 + 10, 10, 1.2), { tone: "faint" }));
  out.push(L(faceRing(front, -(y + 9), z0 + 7.5, 1.8), { tone: "lo" }));
  out.push(D([at(onFace(front, -(y + 9), z0 + 7.5))], { size: 0.6, tone: "hi" }));
  out.push(jack(front, -65, 8.5));
  return out.join("");
}

function keyboard() {
  const plan = M.KEYBOARD;
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, 3, P)}"/>`];
  out.push(S(k.slabOf(plan, 0, 4, P, 4, 0.6), { tone: "mid" }));
  const keys = [];
  const rows = [13, 13, 12, 11, 0];
  const pitch = 103 / 13;
  rows.forEach((count, r) => {
    const x = plan.x + 4 + r * 7;
    if (!count) {
      const widths = [1.5, 1.5, 6, 1.5, 1.5];
      let y = plan.y + 4;
      for (const span of widths) {
        keys.push({ x, y, w: 7, d: span * pitch });
        y += span * pitch;
      }
      return;
    }
    const wide = (13 - count) * pitch;
    let y = plan.y + 4;
    for (let i = 0; i < count; i++) {
      const span = i === count - 1 ? pitch + wide : pitch;
      keys.push({ x, y, w: 7, d: span });
      y += span;
    }
  });
  for (const key of byDepth(keys, (key) => [key.x + key.w / 2, key.y + key.d / 2, 4])) {
    const cap = { x: key.x + 0.7, y: key.y + 0.7, w: key.w - 1.4, d: key.d - 1.4, r: 0 };
    out.push(S(k.slabOf(cap, 4, 1.8, P, 1), { tone: "mid", crease: "none" }));
  }
  return out.join("");
}

function jack(face, u, z) {
  return L(faceRect(face, u, z, 10, 8.6, 1), { tone: "lo" }) + D([at(onFace(face, u - 3.4, z + 5.6)), at(onFace(face, u + 3.4, z + 5.6))], { size: 0.55, tone: "hi" });
}

function relay() {
  const plan = M.RELAY;
  const z = M.RELAY_Z;
  const top = M.RELAY_TOP;
  const front = { axis: "y", at: M.RELAY_FRONT };
  const side = { axis: "x", at: M.RELAY_SIDE };
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, 10, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(plan, 9), ([x, y]) => [x, y, 0])) out.push(S(k.cylinder(x, y, 4.4, 0, z, P, 20), { tone: "lo" }));
  const seams = L(k.sideSeam(plan, z + 4, P, 4) + k.sideSeam(plan, top - 5, P, 4), { tone: "faint" });
  out.push(S(k.slabOf(plan, z, top - z, P, 4, 1.2), { tone: "mid", inner: seams }));
  out.push(L(k.planOutline(k.insetPlan(plan, 4), top, P, 3), { tone: "faint" }));
  out.push(screws(k.corners(plan, 7.5), top, 1.5));
  out.push(L(Array.from({ length: 9 }, (_, i) => k.planOutline({ x: -36 + i * 5.2, y: -28, w: 1.8, d: 26, r: 0.9 }, top, P, 2)).join(""), { tone: "faint" }));
  const label = { x: 6, y: 6, w: 32, d: 16, r: 1.2 };
  out.push(S(k.slabOf(label, top, 0.5, P, 3), { tone: "lo", crease: "none" }));
  out.push(L([22, 16, 19].map((w, i) => k.lineOnTop([label.x + 4, label.y + 4 + i * 4], [label.x + 4 + w, label.y + 4 + i * 4], top + 0.5, P)).join(""), { tone: "lo", free: true }));
  out.push(screenSvg("relay", ""));
  out.push(L(slots(front, -16, 6, 8.5, 21, 6, 1.6) + slots(front, 22, 34, 8.5, 21, 4, 1.6), { tone: "faint" }));
  out.push(jack(front, -28, M.PORT_Z));
  out.push(jack(front, 14, M.PORT_Z));
  out.push(L(faceRing(front, 31, 47, 2.1), { tone: "lo" }));
  out.push(`<path class="iso-line" data-tone="lo" data-led="" d="${faceRing(front, 31, 47, 0.9, 12)}"/>`);
  out.push(L(faceRing(front, 31, 36, 2.6), { tone: "lo" }) + L(faceRing(front, 31, 36, 1.5), { tone: "faint" }));
  out.push(L(slots(side, -26, 26, 30, 48, 11, 1.6), { tone: "faint" }));
  out.push(jack(side, -14, M.PORT_Z));
  out.push(jack(side, 16, M.PORT_Z));
  for (const x of [-42, 42]) {
    for (const zz of [15, 44]) out.push(S(k.slabOf({ x: x - 1.2, y: M.RELAY_FRONT, w: 2.4, d: 3.4, r: 0.6 }, zz, 3, P, 2), { tone: "mid" }));
    out.push(S(k.slabOf({ x: x - 1.5, y: M.RELAY_FRONT + 3.4, w: 3, d: 2.4, r: 1 }, 13, 36, P, 3, 0.4), { tone: "mid" }));
  }
  return out.join("");
}

function plug(at0, axis, kind) {
  const spec = M.PLUG[kind];
  const across = axis[0] ? [0, 1, 0] : [1, 0, 0];
  const box = (s0, s1, bw, bh, r) => {
    const a = [at0[0] + axis[0] * s0, at0[1] + axis[1] * s0];
    const b = [at0[0] + axis[0] * s1, at0[1] + axis[1] * s1];
    const x0 = Math.min(a[0], b[0]) - (across[0] * bw) / 2;
    const x1 = Math.max(a[0], b[0]) + (across[0] * bw) / 2;
    const y0 = Math.min(a[1], b[1]) - (across[1] * bw) / 2;
    const y1 = Math.max(a[1], b[1]) + (across[1] * bw) / 2;
    return { plan: { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z: at0[2] - bh / 2, h: bh, mid: [(x0 + x1) / 2, (y0 + y1) / 2, at0[2]] };
  };
  const body = box(0, spec.body, spec.bw, spec.bh, 0.8);
  const boot = box(spec.body, spec.body + spec.boot, spec.tw, spec.th, kind === "rj" ? 1.6 : 1.4);
  const parts = [
    { ...body, tone: kind === "rj" ? "hi" : "mid" },
    { ...boot, tone: "mid" },
  ];
  const out = byDepth(parts, (part) => part.mid).map((part) => S(k.slabOf(part.plan, part.z, part.h, P, 2, 0.4), { tone: part.tone }));
  if (kind === "rj") {
    const tab = box(1, spec.body - 1, 3, 0.8, 0.4);
    out.push(S(k.slabOf(tab.plan, body.z + body.h, 0.8, P, 2), { tone: "mid" }));
  }
  return out.join("");
}

function clipOnCable(name, s) {
  const route = M.ROUTES[name];
  const p = G.pointAlong(route.points, s);
  const tangent = G.tangentAlong(route.points, s);
  const alongX = Math.abs(tangent[0]) > Math.abs(tangent[1]);
  const w = alongX ? 4 : 9;
  const d = alongX ? 9 : 4;
  const saddle = { x: p[0] - w / 2, y: p[1] - d / 2, w, d, r: 1 };
  const tabs = alongX
    ? [
        [p[0], p[1] - 6.6],
        [p[0], p[1] + 6.6],
      ]
    : [
        [p[0] - 6.6, p[1]],
        [p[0] + 6.6, p[1]],
      ];
  const out = [];
  for (const [x, y] of byDepth(tabs, ([x, y]) => [x, y, 0])) {
    out.push(S(k.slabOf({ x: x - 2.4, y: y - 2.4, w: 4.8, d: 4.8, r: 1.2 }, 0, 0.9, P, 3), { tone: "mid" }));
    out.push(D([at([x, y, 0.9])], { size: 0.5, tone: "hi" }));
  }
  out.splice(alongX ? 2 : 2, 0, S(k.slabOf(saddle, 0, M.CABLE_R * 2 + 0.6, P, 3, 0.4), { tone: "mid" }));
  return out.join("");
}

function packetSvg(name) {
  const { w, d, h, lock } = M.PACKET;
  const box = { x: -w / 2, y: -d / 2, w, d, r: 1.2 };
  const strap = k.segment([0, d / 2, 0], [0, d / 2, h], P) + k.segment([w / 2, 0, 0], [w / 2, 0, h], P) + k.lineOnTop([-w / 2, 0], [w / 2, 0], h, P) + k.lineOnTop([0, -d / 2], [0, d / 2], h, P);
  const out = [S(k.slabOf(box, 0, h, P, 3, 0.5), { tone: "lit", lit: true, inner: L(strap, { tone: "lit" }) })];
  const body = { x: -lock.w / 2, y: -lock.d / 2, w: lock.w, d: lock.d, r: 0.9 };
  const top = h + lock.h;
  const shackle = G.fillet(
    [
      [-lock.r, 0, top - 1.2],
      [-lock.r, 0, top + 2.2],
      [-lock.r, 0, top + 2.2 + lock.r],
      [lock.r, 0, top + 2.2 + lock.r],
      [lock.r, 0, top + 2.2],
      [lock.r, 0, top - 1.2],
    ],
    lock.r,
    10,
  );
  const pieces = tubePieces(shackle, lock.tube, P, { maxLength: 80 });
  out.push(`<g data-shackle="">${pieces.map((piece) => tubeSvg(piece, { tone: "lit" })).join("")}</g>`);
  out.push(S(k.slabOf(body, h, lock.h, P, 3, 0.4), { tone: "lit", lit: true }));
  out.push(D([at([0, lock.d / 2, h + lock.h * 0.45])], { size: 0.7, tone: "hi" }));
  const state = M.packetState(name, M.STILL);
  const offset = M.packetAt(name, state.s);
  return `<g data-packet="${name}" transform="${k.translateAlong(P, offset)}" opacity="${state.opacity.toFixed(2)}">${out.join("")}</g>`;
}

const TOWARD = (axis) => G.dot3(axis, G.viewOf(P)) > 0;

function cableGroup(name) {
  const port = M.PORTS[name];
  const device = M.DEVICE_PORTS[name];
  const route = M.ROUTES[name];
  const out = [plug(port.relay, port.axis, "rj")];
  const devicePlug = plug(device.at, device.axis, device.kind);
  if (TOWARD(device.axis)) out.push(devicePlug);
  const pieces = tubePieces(route.points, M.CABLE_R, P, { maxLength: 400, spacing: 3.2 });
  out.push(pieces.map((piece) => tubeSvg(piece, { tone: "mid" })).join(""));
  if (name === "claude") out.push(clipOnCable(name, route.length * 0.55));
  if (name === "codex") out.push(clipOnCable(name, route.length * 0.5));
  out.push(packetSvg(name));
  if (!TOWARD(device.axis)) out.push(devicePlug);
  return `<g data-cable="${name}">${out.join("")}</g>`;
}

function phone() {
  const out = [`<path class="iso-halo" d="${k.haloOf(M.DOCK, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(M.DOCK, 0, 6, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(M.DOCK, 1.6, P, 6), { tone: "faint" }) }));
  const { F, w, h, t, tilt, z0 } = M.PHONE;
  const up = [-Math.sin(tilt), 0, Math.cos(tilt)];
  const normal = [Math.cos(tilt), 0, Math.sin(tilt)];
  const foot = M.local(F, [0, t / 2, z0]);
  const frame = G.frameOf(foot, normal, F.r, up);
  const shape = k.roundedPlan({ x: -w / 2, y: 0, w, d: h, r: 6 }, 6);
  out.push(S(G.prismOf(frame, shape, -t, 0, P), { tone: "mid" }));
  const near = (u, v) => [foot[0] + F.r[0] * u + up[0] * v, foot[1] + F.r[1] * u + up[1] * v, foot[2] + up[2] * v];
  out.push(D([at(near(0, h - 4))], { size: 0.6, tone: "lo" }));
  out.push(screenSvg("phone", CHROME.phone()));
  out.push(S(k.slabOf({ x: 167.5, y: M.DOCK.y + 3, w: 4, d: M.DOCK.d - 6, r: 1.5 }, 6, 4.5, P, 3, 0.4), { tone: "mid" }));
  return out.join("");
}

function codexLaptop() {
  return laptop(M.CODEX, "codex");
}

function personLaptop() {
  return laptop(M.LAPTOP, "laptop");
}

export default function figure() {
  clips.length = 0;
  const parts = [bench(), codexLaptop(), monitor(), mini(), keyboard(), relay(), cableGroup("claude"), cableGroup("codex"), cableGroup("laptop"), cableGroup("phone"), personLaptop(), phone()];
  const body = [`<defs>${clips.join("")}</defs>`, ...parts];
  return k.figureSvg({
    width: M.W,
    height: M.H,
    label:
      "A workbench with a small relay server box in the middle, cabled to a laptop running the Channels app, a monitor and keyboard running Claude Code, a second laptop running Codex, and a phone. A line typed on the laptop leaves as a padlocked packet, shows only as scrambled ciphertext on the relay's little screen, and goes out on every other cable at once; at each device the padlock opens and the same line appears on its screen. Then an agent answers and the trip runs the other way.",
    body,
  });
}
