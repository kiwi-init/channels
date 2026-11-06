import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import {
  BELT,
  BELT_Z,
  BIN,
  BIN_H,
  BOX,
  BOX_TOP,
  COUNTER,
  DIAL,
  ENV,
  FEED_IN,
  FEED_OUT,
  FRONT,
  HEIGHT,
  KICK,
  LAMP,
  LANDING,
  MARK,
  LANE,
  LAPTOP,
  P,
  PAN,
  RECEIVER,
  REST,
  SCALE,
  SENDER,
  STAMP,
  TOP,
  TRAY,
  CLIP,
  WIDTH,
  faceMatrix,
  lidFrame,
  rodSvg,
  screenMatrix,
} from "./model.js";

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, steps = 3, bevel = 0) => k.slabOf(plan, z, h, P, steps, bevel);
const plan = (x0, y0, x1, y1, r = 1) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const rect = (x0, y0, x1, y1, r = 0, steps = 4) => k.pathOf(k.roundedPlan(plan(x0, y0, x1, y1, r), steps), true);
const onX = (x, y0, y1, z0, z1, r = 0.8) =>
  k.pathOf(
    k.roundedPlan(plan(y0, z0, y1, z1, r), 3).map(([y, z]) => at([x, y, z])),
    true,
  );
const onY = (y, x0, x1, z0, z1, r = 0.8) =>
  k.pathOf(
    k.roundedPlan(plan(x0, z0, x1, z1, r), 3).map(([x, z]) => at([x, y, z])),
    true,
  );
const text = (transform, x, y, value, size, tone, extra = "") =>
  `<text class="iso-face-text" data-tone="${tone}"${transform ? ` transform="${transform}"` : ""} x="${x}" y="${y}" font-size="${size}"${extra}>${value}</text>`;

function screws(points, z, r = 1.6) {
  return (
    L(points.map(([x, y]) => k.ring(x, y, r, z, P, 12)).join(""), { tone: "lo" }) +
    D(
      points.map(([x, y]) => at([x, y, z])),
      { size: 0.45 },
    )
  );
}

function laptop(spot, screen, port) {
  const base = { x: spot.x, y: spot.y, w: LAPTOP.w, d: LAPTOP.d, r: 6 };
  const top = LAPTOP.h;
  const out = [`<path class="iso-halo" d="${k.haloOf(base, 0, top, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(base, 12))) out.push(S(k.cylinder(x, y, 3.4, 0, 1.3, P, 18), { tone: "lo" }));
  out.push(S(slab(base, 1.2, top - 1.2, 8, 1), { tone: "mid", inner: L(k.sideSeam(base, 3.6, P, 8), { tone: "faint" }) }));
  const well = plan(spot.x + 11, spot.y + 13, spot.x + 129, spot.y + 57, 2.5);
  out.push(L(k.planOutline(well, top, P, 4), { tone: "lo" }));
  const keys = [];
  const pitch = 118 / 13;
  for (let row = 0; row < 5; row++) {
    const y = well.y + 1.4 + row * 8.4;
    const cells =
      row === 4
        ? [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 10],
            [10, 11],
            [11, 12],
            [12, 13],
          ]
        : Array.from({ length: 13 }, (_, i) => [i, i + 1]);
    for (const [a, b] of cells) keys.push(k.planOutline(plan(well.x + 1 + a * pitch, y, well.x - 0.6 + b * pitch, y + 7, 1), top, P, 2));
  }
  out.push(L(keys.join(""), { tone: "faint" }));
  out.push(L(k.planOutline(plan(spot.x + 44, spot.y + 63, spot.x + 96, spot.y + 89, 2.6), top, P, 4), { tone: "lo" }));
  if (port) {
    out.push(L(onX(spot.x + LAPTOP.w, spot.y + 30, spot.y + 34, 3.4, 4.8, 0.6), { tone: "faint" }));
    out.push(L(onX(spot.x + LAPTOP.w, spot.y + 40, spot.y + 46, 3, 5.2, 0.6), { tone: "lo" }));
  }
  const F = lidFrame(spot);
  const lid = G.prismOf(F, k.roundedPlan({ x: 0, y: 0, w: LAPTOP.w, d: LAPTOP.lid, r: 5 }, 6), -4, 0, P);
  out.push(S(G.disc(0, LAPTOP.w - 30, 2.4, G.frameAlong([spot.x + 15, spot.y + 3.6, top + 1.4], [1, 0, 0]), P), { tone: "mid", crease: "none" }));
  out.push(S(lid, { tone: "mid" }));
  out.push(`<g transform="${screenMatrix(spot)}">`);
  out.push(`<path class="iso-fill" d="${rect(6, 6, 134, 79, 1.6)}"/>`);
  out.push(screen);
  out.push(`<path class="iso-line" data-tone="lo" d="${rect(6, 6, 134, 79, 1.6)}"/>`);
  out.push(`<circle class="iso-line" data-tone="faint" cx="70" cy="3.2" r="0.9"/>`);
  out.push(`</g>`);
  return out.join("");
}

function chatScreen() {
  return [
    `<path class="iso-line" data-tone="faint" d="M6 15H134"/>`,
    text("", 11, 12.6, "# launch", 4.6, "lo"),
    `<circle class="iso-line" data-tone="lo" cx="14" cy="24" r="3"/>`,
    `<path class="iso-line" data-tone="faint" data-free="" d="M21 22.6H76M21 26.4H58"/>`,
    `<circle class="iso-line" data-tone="lo" cx="14" cy="37" r="3"/>`,
    `<path class="iso-line" data-tone="faint" data-free="" d="M21 35.6H92M21 39.4H48"/>`,
    `<path class="iso-line" data-tone="mid" d="${rect(34, 47, 129, 60.5, 4.5)}"/>`,
    `<clipPath id="sl-type"><rect data-part="type" x="34" y="44" width="${(REST.typed * 95).toFixed(2)}" height="18"/></clipPath>`,
    `<g clip-path="url(#sl-type)">${text("", 39.5, 56, REST.phrase, 6.2, "hi", ' data-part="said"')}</g>`,
    `<path class="iso-line" data-tone="faint" d="${rect(10, 66, 130, 75, 3)}"/>`,
  ].join("");
}

function terminalScreen() {
  const rows = REST.rows
    .map((phrase, i) => {
      const y = 41 + i * 9;
      const last = i === REST.rows.length - 1;
      return `<g data-row="${i}">${text("", 11, y, "maya", 5.6, last ? "mid" : "lo")}${text("", 30, y, phrase, 5.6, last ? "hi" : "lo")}</g>`;
    })
    .join("");
  return [
    `<path class="iso-line" data-tone="faint" d="M6 15H134"/>`,
    text("", 11, 12.6, "✻ claude", 4.6, "lo"),
    `<path class="iso-line" data-tone="faint" data-free="" d="M11 22.4H82M11 27.4H64"/>`,
    `<clipPath id="sl-term"><rect x="6" y="30.5" width="128" height="32"/></clipPath>`,
    `<g clip-path="url(#sl-term)"><g data-part="rows">${rows}</g></g>`,
    text("", 11, 72, "❯", 5.6, "mid"),
    `<rect class="sl-cursor" x="17" y="67.4" width="3" height="5.4"/>`,
  ].join("");
}

function counter() {
  const out = [`<path class="iso-halo" d="${k.haloOf(COUNTER, 0, TOP, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(COUNTER, 16))) {
    out.push(S(k.cylinder(x, y, 6.4, 0, 1.4, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 4.8, 1.4, 1.6, P, 24), { tone: "mid" }));
  }
  out.push(S(slab(COUNTER, 3, TOP - 3, 8, 1.2), { tone: "mid", inner: L(k.sideSeam(COUNTER, 6.2, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(COUNTER, 4), TOP, P, 8), { tone: "faint" }));
  out.push(screws(k.corners(COUNTER, 9), TOP, 1.5));
  const end = COUNTER.x + COUNTER.w;
  out.push(S(slab(plan(end, -4, end + 3, 10, 1), 4, 6, 3), { tone: "mid" }));
  out.push(D([at([end + 3, -1, 9]), at([end + 3, 7, 9])], { size: 0.4 }));
  return out.join("");
}

let clips = 0;
function recess(x0, x1, z0, z1, r, depth, back = "") {
  const id = `sl-clip-${clips++}`;
  const ring = k.roundedPlan(plan(x0, z0, x1, z1, r), 5);
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
    const quad = k.pathOf([at([ax, FRONT, az]), at([bx, FRONT, bz]), at([bx, FRONT - depth, bz]), at([ax, FRONT - depth, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))].push(quad);
  });
  const shape = k.pathOf(
    ring.map(([x, z]) => [x, -z]),
    true,
  );
  const plane = k.sideMatrix([0, FRONT - depth], 0, P, "left");
  return [
    `<clipPath id="${id}"><path transform="${faceMatrix()}" d="${shape}"/></clipPath>`,
    `<g clip-path="url(#${id})">`,
    `<path class="iso-top" d="${tops.join("")}"/>`,
    ...sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")),
    `<g transform="${plane}"><path class="iso-fill" d="${shape}"/>${back}<path class="iso-line" data-tone="faint" d="${shape}"/></g>`,
    `</g>`,
    `<g transform="${faceMatrix()}"><path class="iso-line" data-tone="lo" d="${shape}"/></g>`,
  ].join("");
}

function relayScreen() {
  return `<g data-part="cipher">${REST.cipher.map((row, i) => text("", -33, -(60.6 - i * 5.6), row, 4.4, i === 2 ? "mid" : "lo", ` data-cipher="${i}"`)).join("")}</g>`;
}

function box() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOX, TOP, BOX_TOP - TOP, P)}"/>`];
  out.push(S(slab(k.insetPlan(BOX, 2.5), TOP, 2.2, 6), { tone: "lo" }));
  out.push(S(slab(BOX, TOP + 2.2, BOX_TOP - TOP - 2.2, 6, 1.2), { tone: "mid", inner: L(k.sideSeam(BOX, BOX_TOP - 7, P, 6), { tone: "faint" }) }));
  const vents = Array.from({ length: 8 }, (_, i) => k.planOutline(plan(BOX.x + 16 + i * 7.6, BOX.y + 14, BOX.x + 19 + i * 7.6, BOX.y + 44, 1.5), BOX_TOP, P, 3));
  out.push(L(vents.join(""), { tone: "faint" }));
  out.push(screws(k.corners(BOX, 6), BOX_TOP, 1.4));
  const side = BOX.x + BOX.w;
  out.push(L(Array.from({ length: 6 }, (_, i) => onX(side, BOX.y + 10 + i * 5.2, BOX.y + 12.4 + i * 5.2, 36, 58, 1.2)).join(""), { tone: "faint" }));
  out.push(L(onX(side, BOX.y + 44, BOX.y + 56, 22, 30, 1) + onX(side, BOX.y + 45.6, BOX.y + 54.4, 23.6, 28.4, 0.6), { tone: "lo" }));
  out.push(D([at([side, BOX.y + 8, 26]), at([side, BOX.y + 13, 26])], { size: 0.6, tone: "mid" }));
  out.push(L(onX(side, BOX.y + 5, BOX.y + 16, 22, 30, 1.6), { tone: "lo" }));
  out.push(recess(-38, 38, 45, 66, 2.6, 2, relayScreen()));
  out.push(`<g transform="${faceMatrix()}"><path class="iso-line" data-tone="lo" d="${rect(26, -32.2, 40, -28, 2.1)}"/></g>`);
  out.push(D([at([29, FRONT, 30.1]), at([33, FRONT, 30.1])], { size: 0.7, tone: "mid" }));
  out.push(`<g data-part="led">${D([at([37, FRONT, 30.1])], { size: 0.8, tone: "hi" })}</g>`);
  out.push(text(faceMatrix(), 26, -23.6, "relay", 4.2, "lo"));
  return out.join("");
}

function tray() {
  const { x, y, w, d } = TRAY;
  const t = 1.4;
  const h = 7;
  const out = [`<path class="iso-halo" d="${k.haloOf(TRAY, TOP, h, P)}"/>`];
  out.push(S(slab(TRAY, TOP, t, 4), { tone: "lo" }));
  out.push(S(slab(plan(x, y, x + w, y + t, 0.5), TOP + t, h - t, 2), { tone: "mid" }));
  out.push(S(slab(plan(x, y, x + t, y + d, 0.5), TOP + t, h - t, 2), { tone: "mid" }));
  const cx = x + w / 2;
  const cy = y + d / 2;
  const ew = ENV.w / 2 - 3;
  const ed = ENV.d / 2 - 2.4;
  for (let i = 0; i < 5; i++) {
    const z = TOP + t + i * ENV.h;
    const dx = [0.6, -0.8, 0.4, -0.4, 0][i];
    const dy = [0.3, -0.4, 0.5, -0.2, 0][i];
    out.push(S(slab(plan(cx + dx - ew, cy + dy - ed, cx + dx + ew, cy + dy + ed, 0.6), z, ENV.h, 2), { tone: "hi" }));
  }
  const zt = TOP + t + 5 * ENV.h;
  const tip = [cx, cy - ed + ed * 2 * 0.58];
  out.push(L(k.onTop([[cx - ew, cy - ed], tip, [cx + ew, cy - ed]], zt, P), { tone: "lo" }));
  out.push(S(k.cylinder(tip[0], tip[1], 2.6, zt, 0.7, P, 18), { tone: "hi" }));
  out.push(L(k.ring(tip[0], tip[1], 1.3, zt + 0.7, P, 12), { tone: "lo" }));
  out.push(S(slab(plan(x + w - t, y, x + w, y + d, 0.5), TOP + t, h - t, 2, 0.3), { tone: "mid" }));
  out.push(S(slab(plan(x, y + d - t, x + w, y + d, 0.5), TOP + t, h - t, 2, 0.3), { tone: "mid" }));
  return out.join("");
}

function feeder(f, slot) {
  const h = 23;
  const top = TOP + h;
  const out = [S(slab(f, TOP, h, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(f, TOP + 19, P, 4), { tone: "faint" }) })];
  out.push(L(Array.from({ length: 7 }, (_, i) => k.planOutline(plan(f.x + 6 + i * 3.6, f.y + 7, f.x + 7.8 + i * 3.6, f.y + 25, 0.9), top, P, 3)).join(""), { tone: "faint" }));
  out.push(screws(k.corners(f, 3.6), top, 1.2));
  const face = f.y + f.d;
  out.push(L(onY(face, f.x + 5, f.x + 20, TOP + 6, TOP + 14, 1.4), { tone: "lo" }));
  out.push(D([at([f.x + f.w - 6, face, TOP + 10])], { size: 0.7, tone: slot ? "hi" : "mid" }));
  if (slot) {
    const x = f.x + f.w;
    const shape = onX(x, LANE - ENV.d / 2 - 1.4, LANE + ENV.d / 2 + 1.4, BELT_Z - 0.2, BELT_Z + 3.6, 1);
    out.push(`<path class="iso-fill" d="${shape}"/>`, L(shape, { tone: "lo" }));
  }
  return out.join("");
}

function railPieces(gaps) {
  const cuts = [FEED_IN.x + FEED_IN.w, ...gaps.flat(), FEED_OUT.x];
  const pieces = [];
  for (let i = 0; i < cuts.length; i += 2) pieces.push([cuts[i], cuts[i + 1]]);
  return pieces;
}

function beltBack() {
  const out = [];
  for (const [x0, x1] of railPieces([[KICK.x - 14, KICK.x + 14]])) out.push(S(slab(plan(x0, BELT.y0 - 2, x1, BELT.y0, 0.6), TOP, 6.5, 2), { tone: "mid" }));
  out.push(S(k.cylinder(PAN.x + PAN.w / 2, LANE, 3.4, TOP, BELT_Z - TOP - 1.4, P, 16), { tone: "lo" }));
  for (const [x0, x1] of [
    [FEED_IN.x + FEED_IN.w, PAN.x - 1.4],
    [PAN.x + PAN.w + 1.4, FEED_OUT.x],
  ]) {
    const ribs = [];
    for (let x = x0 + 3; x < x1 - 2; x += 6) ribs.push(k.planOutline(plan(x, BELT.y0 + 1.4, x + 0.9, BELT.y1 - 1.4, 0.45), BELT_Z, P, 2));
    out.push(S(slab(plan(x0, BELT.y0, x1, BELT.y1, 0.8), TOP, BELT_Z - TOP, 2), { tone: "lo" }));
    out.push(L(ribs.join(""), { tone: "faint" }));
  }
  out.push(`<g data-part="pan" transform="${k.translateAlong(P, [0, 0, -REST.pan])}">`);
  out.push(S(slab(PAN, BELT_Z - 1.4, 1.4, 3, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PAN, 2.2), BELT_Z, P, 3), { tone: "faint" }));
  out.push(`</g>`);
  return out.join("");
}

function beltFront() {
  const out = [];
  for (const [x0, x1] of railPieces([
    [SCALE.x - 1, SCALE.x + SCALE.w + 1],
    [KICK.x - 20, KICK.x + 20],
  ])) {
    out.push(S(slab(plan(x0, BELT.y1, x1, BELT.y1 + 2, 0.6), TOP, 6.5, 2), { tone: "mid" }));
    const caps = [];
    for (let x = x0 + 4; x < x1 - 2; x += 12) caps.push(at([x, BELT.y1 + 2, TOP + 3.4]));
    out.push(D(caps, { size: 0.55, tone: "mid" }));
  }
  return out.join("");
}

function scale() {
  const { x, w, y, d, z0, z1 } = SCALE;
  const face = y + d;
  const { r } = DIAL;
  const cx = DIAL.x;
  const cz = DIAL.z;
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const angle = ((-120 + i * 24) * Math.PI) / 180;
    const inner = i % 5 === 0 ? r - 2.6 : r - 1.9;
    const outer = r - 1;
    ticks.push(
      `M${(cx + Math.sin(angle) * inner).toFixed(2)} ${(-cz - Math.cos(angle) * inner).toFixed(2)}L${(cx + Math.sin(angle) * outer).toFixed(2)} ${(-cz - Math.cos(angle) * outer).toFixed(2)}`,
    );
  }
  const M = k.sideMatrix([0, face], 0, P, "left");
  const body = plan(x, y, x + w, face, 1.4);
  return [
    S(slab(body, z0, z1 - z0, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(body, z1 - 3, P, 3), { tone: "faint" }) }),
    D([at([x + 3, face, z1 - 6.4]), at([x + w - 3, face, z1 - 6.4])], { size: 0.45 }),
    `<g transform="${M}">`,
    `<circle class="iso-fill" cx="${cx}" cy="${-cz}" r="${r}"/>`,
    `<circle class="iso-line" data-tone="mid" cx="${cx}" cy="${-cz}" r="${r}"/>`,
    `<circle class="iso-line" data-tone="faint" cx="${cx}" cy="${-cz}" r="${r - 1}"/>`,
    `<path class="iso-line" data-tone="lo" d="${ticks.join("")}"/>`,
    `<g data-part="needle" transform="rotate(${REST.needle.toFixed(2)} ${cx} ${-cz})"><path class="iso-line" data-tone="hi" data-free="end" d="M${cx} ${-cz + 1.2}V${-cz - r + 1.8}"/></g>`,
    `<circle class="iso-line" data-tone="mid" cx="${cx}" cy="${-cz}" r="0.8"/>`,
    `</g>`,
  ].join("");
}

function stampLow() {
  const { x, y, r, pad } = STAMP;
  return [
    `<g data-part="stamp-low" transform="${k.translateAlong(P, [0, 0, -REST.stamp])}">`,
    S(k.cylinder(x, y, r - 0.6, pad, 1.8, P, 28), { tone: "lo" }),
    S(k.cylinder(x, y, r, pad + 1.8, 6, P, 32, 0.5), { tone: "mid", inner: L(k.sideArc(x, y, r, pad + 4.8, P, 20), { tone: "faint" }) }),
    S(k.cylinder(x, y, 1.4, pad + 7.8, 40 - pad - 7.8, P, 12), { tone: "mid", crease: "none" }),
    `</g>`,
  ].join("");
}

function stampHigh() {
  const { x, y } = STAMP;
  return [
    S(slab(plan(x - 5, FRONT, x + 5, y + 5.5, 1.2), 40, 4, 3, 0.4), { tone: "mid" }),
    S(k.cylinder(x, y, 2.8, 44, 1.2, P, 16), { tone: "lo" }),
    D([at([x - 3, FRONT + 2.4, 44]), at([x + 3, FRONT + 2.4, 44])], { size: 0.4 }),
    `<g data-part="stamp-high" transform="${k.translateAlong(P, [0, 0, -REST.stamp])}">`,
    S(k.cylinder(x, y, 1.4, 45.2, 2.8, P, 12), { tone: "mid", crease: "none" }),
    S(k.cylinder(x, y, 4, 48, 4.4, P, 24, 0.4), { tone: "hi" }),
    L(k.knurl(x, y, 4, 48.5, 51.9, 20, P), { tone: "lo" }),
    `</g>`,
  ].join("");
}

function lamp() {
  const { x, y } = LAMP;
  const F = G.frameOf([x, y, 38], [0, 0, -1], [1, 0, 0], [0, -1, 0]);
  const shade = G.solidOf(
    [
      [0, 2.6],
      [1.6, 2.6],
      [1.6, 3.2, 1],
      [4.4, 4.6, 1],
      [7.2, 7.4, 1],
      [7.6, 7.6],
    ],
    F,
    P,
  );
  return [S(slab(plan(x - 2.6, FRONT, x + 2.6, y + 2, 1), 38, 3, 3), { tone: "mid" }), S(shade, { tone: "mid" })].join("");
}

function clipboard() {
  const { x, y, w } = CLIP;
  const paper = k.insetPlan(CLIP, 3);
  const z = TOP + 1.4;
  const out = [`<path class="iso-halo" d="${k.haloOf(CLIP, TOP, 1.4, P)}"/>`];
  out.push(S(slab(CLIP, TOP, 1.4, 4, 0.4), { tone: "lo" }));
  out.push(S(slab(paper, z, 0.4, 2), { tone: "hi", crease: "none" }));
  const rows = [];
  const seals = [];
  for (let i = 0; i < 5; i++) {
    const ry = y + 13 + i * 5.6;
    seals.push(k.ring(x + 8, ry, 1.7, z + 0.4, P, 14));
    rows.push(k.lineOnTop([x + 12, ry - 0.8], [x + w - 7 - (i % 3) * 5, ry - 0.8], z + 0.4, P), k.lineOnTop([x + 12, ry + 0.8], [x + 26 + (i % 2) * 6, ry + 0.8], z + 0.4, P));
  }
  out.push(L(seals.join(""), { tone: "mid" }));
  out.push(L(rows.join(""), { tone: "lo", free: true }));
  out.push(S(slab(plan(x + w / 2 - 9, y + 1.6, x + w / 2 + 9, y + 7, 1.2), z + 0.4, 2.2, 3, 0.4), { tone: "mid" }));
  out.push(D([at([x + w / 2 - 5, y + 4.3, z + 2.6]), at([x + w / 2 + 5, y + 4.3, z + 2.6])], { size: 0.45 }));
  return out.join("");
}

function kicker() {
  return [
    S(slab(plan(KICK.x - 6, FRONT, KICK.x + 6, FRONT + 1.4, 0.5), BELT_Z - 0.2, 6.4, 2), { tone: "mid" }),
    `<g data-part="rod">${rodSvg(REST.kick)}</g>`,
    `<g data-part="kicker" transform="${k.translateAlong(P, [0, REST.kick, 0])}">`,
    S(slab(plan(KICK.x - 12, FRONT + 1.4, KICK.x + 12, FRONT + 3.4, 0.6), BELT_Z + 0.3, 4.6, 2, 0.3), { tone: "mid" }),
    D([at([KICK.x - 8, FRONT + 3.4, BELT_Z + 3]), at([KICK.x + 8, FRONT + 3.4, BELT_Z + 3])], { size: 0.4 }),
    `</g>`,
  ].join("");
}

function bin(part) {
  const { x, y, w, d } = BIN;
  const t = 1.6;
  if (part === "back") {
    return [
      `<path class="iso-halo" d="${k.haloOf(BIN, 0, BIN_H, P)}"/>`,
      S(slab(BIN, 0, t, 4), { tone: "lo" }),
      S(slab(plan(x, y, x + w, y + t, 0.6), t, BIN_H - t, 2), { tone: "mid" }),
      S(slab(plan(x, y, x + t, y + d, 0.6), t, BIN_H - t, 2), { tone: "mid" }),
    ].join("");
  }
  return [
    S(slab(plan(x + w - t, y, x + w, y + d, 0.6), t, BIN_H - t, 2, 0.3), { tone: "mid" }),
    S(slab(plan(x, y + d - t, x + w, y + d, 0.6), t, BIN_H - t, 2, 0.3), { tone: "mid" }),
    D([at([x + 5, y + d, BIN_H - 2.4]), at([x + w - 5, y + d, BIN_H - 2.4])], { size: 0.45 }),
  ].join("");
}

function sealSvg(cx, cy, z, forged, lit) {
  const r = 3.4;
  if (!forged) return S(k.cylinder(cx, cy, r, z, 0.9, P, 22), { tone: "hi", lit }) + L(k.ring(cx, cy, 1.8, z + 0.9, P, 16), { tone: lit ? "lit" : "lo" });
  const half = (sign) => {
    const ring = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      ring.push([cx + sign * (0.8 + Math.cos(a) * r), cy + Math.sin(a) * r + sign * 0.6]);
    }
    return S(k.extrude(ring, z, 0.9, P), { tone: "hi", lit });
  };
  return half(-1) + half(1);
}

function envelopeSvg(kind, postmark) {
  const forged = kind === "forged";
  const x0 = -ENV.w / 2;
  const y0 = LANE - ENV.d / 2;
  const x1 = ENV.w / 2;
  const y1 = LANE + ENV.d / 2;
  const zt = BELT_Z + ENV.h;
  const tip = [0, y0 + ENV.d * 0.58];
  const body = (lit) => S(slab(plan(x0, y0, x1, y1, 0.8), BELT_Z, ENV.h, 2), { tone: "hi", lit });
  const flap = (tone) => L(k.onTop([[x0, y0], tip, [x1, y0]], zt, P), { tone });
  const label =
    L(k.planOutline(plan(x0 + 2.6, y1 - 6, x0 + 12, y1 - 2.4, 0.4), zt, P, 2), { tone: "lo" }) +
    L(k.lineOnTop([x0 + 3.8, y1 - 4.8], [x0 + 10.4, y1 - 4.8], zt, P) + k.lineOnTop([x0 + 3.8, y1 - 3.6], [x0 + 8, y1 - 3.6], zt, P), { tone: "faint", free: true });
  const mark = [MARK[0], LANE + MARK[1]];
  const post = `<g data-part="postmark"${postmark ? "" : ' opacity="0"'}>${L(k.ring(mark[0], mark[1], 4, zt, P, 28) + k.ring(mark[0], mark[1], 2.9, zt, P, 24) + k.lineOnTop([mark[0] - 2.9, mark[1]], [mark[0] + 2.9, mark[1]], zt, P), { tone: "mid" })}</g>`;
  const crack = forged
    ? L(
        k.onTop(
          [
            [tip[0] - 2.2, tip[1] - 2.4],
            [tip[0] - 4.8, tip[1] - 4.6],
            [tip[0] - 6.4, tip[1] - 4.2],
          ],
          zt,
          P,
        ),
        { tone: "lo", free: "end" },
      )
    : "";
  const glow = forged ? body(true) + flap("lit") + label + sealSvg(tip[0], tip[1], zt, true, true) : sealSvg(tip[0], tip[1], zt, false, true);
  return [`<g data-part="plain">${body(false)}${flap("lo")}${label}${crack}${post}${sealSvg(tip[0], tip[1], zt, forged, false)}</g>`, `<g data-part="glow" opacity="0">${glow}</g>`].join("");
}

function envelope(name, kind, offset, { postmark = false, glow = 0, shown = true } = {}) {
  const svg = envelopeSvg(kind, postmark).replace('data-part="glow" opacity="0"', `data-part="glow" opacity="${glow.toFixed(3)}"`);
  return `<g data-env="${name}" transform="${k.translateAlong(P, offset)}"${shown ? "" : ' display="none"'}>${svg}</g>`;
}

function cable(points, r = 1.5) {
  const route = G.fillet(points, 7, 7, { P, tube: r });
  return tubePieces(route, r, P, { maxLength: 400 })
    .map((piece) => tubeSvg(piece, { tone: "lo" }))
    .join("");
}

function emergeClip() {
  const x = FEED_IN.x + FEED_IN.w;
  const a = at([x, -400, BELT_Z]);
  const b = at([x, 400, BELT_Z]);
  const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
  let n = [-(a[1] - b[1]) / length, (a[0] - b[0]) / length];
  const toward = at([x + 10, LANE, BELT_Z]);
  const base = at([x, LANE, BELT_Z]);
  if (n[0] * (toward[0] - base[0]) + n[1] * (toward[1] - base[1]) < 0) n = [-n[0], -n[1]];
  const far = 3000;
  return `<clipPath id="sl-emerge"><path d="${k.pathOf([a, b, [b[0] + n[0] * far, b[1] + n[1] * far], [a[0] + n[0] * far, a[1] + n[1] * far]], true)}"/></clipPath>`;
}

export default function figure() {
  const port = [SENDER.x + LAPTOP.w, SENDER.y + 43, 4.1];
  const forgedSlot = REST.forged.inBin ? "bin" : "belt";
  const forged = envelope("forged", "forged", REST.forged.offset, { postmark: REST.forged.postmark > 0.5, glow: REST.forged.glow });
  const body = [
    `<style>.sl-cursor{fill:var(--anatomy-mid)}</style>`,
    emergeClip(),
    laptop(SENDER, chatScreen(), true),
    S(slab(plan(port[0], port[1] - 3.2, port[0] + 6, port[1] + 3.2, 1.2), 1.6, 5, 3, 0.4), { tone: "mid" }),
    cable([
      [port[0] + 6, port[1], 4.1],
      [COUNTER.x - 5, port[1], 1.5],
      [COUNTER.x - 5, -14, 1.5],
      [COUNTER.x + 8, -14, 1.5],
    ]),
    counter(),
    cable([
      [COUNTER.x + COUNTER.w + 3, 3, 7],
      [COUNTER.x + COUNTER.w + 9, 3, 1.5],
      [COUNTER.x + COUNTER.w + 9, 42, 1.5],
      [RECEIVER.x + 10, 42, 1.5],
    ]),
    tray(),
    box(),
    clipboard(),
    feeder(FEED_IN, true),
    beltBack(),
    kicker(),
    `<g clip-path="url(#sl-emerge)"><g data-slot="belt">`,
    envelope("good", "good", REST.good.offset, { postmark: REST.good.postmark > 0.5, glow: REST.good.glow }),
    forgedSlot === "belt" ? forged : "",
    `</g></g>`,
    beltFront(),
    scale(),
    feeder(FEED_OUT, false),
    stampLow(),
    stampHigh(),
    lamp(),
    bin("back"),
    `<g data-slot="bin">`,
    envelope("old-a", "forged", [LANDING[0] - 6, LANDING[1] + 6 - LANE, 1.6 - BELT_Z], { postmark: true }),
    envelope("old-b", "forged", [LANDING[0] + 4, LANDING[1] - 5 - LANE, 1.6 - BELT_Z + ENV.h], { postmark: true }),
    envelope("old-c", "forged", [LANDING[0], LANDING[1] - LANE, LANDING[2] - BELT_Z], { postmark: true, shown: REST.oldShown, glow: REST.oldGlow }),
    forgedSlot === "bin" ? forged : "",
    `</g>`,
    bin("front"),
    laptop(RECEIVER, terminalScreen(), false),
  ];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A message travels from one laptop to another through a relay drawn as a small postal counter. On the sender's laptop the chat line reads plainly. At the relay it is a sealed envelope on a belt: a scale weighs it, a rubber stamp postmarks the time, a lamp checks the wax seal, and the relay's own screen shows only scrambled ciphertext, beside a tray of sealed envelopes it keeps. An envelope with a broken, foreign seal is pushed off the belt into a reject bin and never goes on. The good envelope goes on to the second laptop, where a terminal running Claude shows the line readable again.",
    body,
  });
}
