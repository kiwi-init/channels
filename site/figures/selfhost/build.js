import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { tubePieces, tubeSvg } from "../../anatomy/tube.js";
import { CABINET, CLIENT, DOOR, FACE, FRONT, HEIGHT, LAPTOP, P, PORT, REST, ROUTES, SERVER, SLOT, SLOTS, WIDTH, drawerBody, lidFrame, screenMatrix, slotZ } from "./model.js";

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
const faceAt = (y) => k.sideMatrix([0, y], 0, P, "left");
const text = (transform, x, y, value, size, tone, extra = "") =>
  `<text class="iso-face-text" data-tone="${tone}"${transform ? ` transform="${transform}"` : ""} x="${x}" y="${y}" font-size="${size}"${extra}>${value}</text>`;

function screws(points, z, r = 1.5) {
  return (
    L(points.map(([x, y]) => k.ring(x, y, r, z, P, 12)).join(""), { tone: "lo" }) +
    D(
      points.map(([x, y]) => at([x, y, z])),
      { size: 0.45 },
    )
  );
}

function feet(box, inset, z = 0, r = 4.4, h = 2.4) {
  return byDepth(k.corners(box, inset))
    .map(([x, y]) => S(k.cylinder(x, y, r, z, h, P, 20), { tone: "lo" }))
    .join("");
}

function laptop(spot) {
  const base = { x: spot.x, y: spot.y, w: LAPTOP.w, d: LAPTOP.d, r: 6 };
  const top = LAPTOP.h;
  const out = [`<path class="iso-halo" d="${k.haloOf(base, 0, top, P)}"/>`];
  out.push(feet(base, 12, 0, 3.4, 1.3));
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
  out.push(L(onX(spot.x + LAPTOP.w, spot.y + 40, spot.y + 44, 3.4, 4.8, 0.6), { tone: "faint" }));
  const F = lidFrame(spot);
  const lid = G.prismOf(F, k.roundedPlan({ x: 0, y: 0, w: LAPTOP.w, d: LAPTOP.lid, r: 5 }, 6), -4, 0, P);
  out.push(S(G.disc(0, LAPTOP.w - 30, 2.4, G.frameAlong([spot.x + 15, spot.y + 3.6, top + 1.4], [1, 0, 0]), P), { tone: "mid", crease: "none" }));
  out.push(S(lid, { tone: "mid" }));
  out.push(`<g transform="${screenMatrix(spot)}">`);
  out.push(`<path class="iso-fill" d="${rect(6, 6, 134, 79, 1.6)}"/>`);
  out.push(terminal());
  out.push(`<path class="iso-line" data-tone="lo" d="${rect(6, 6, 134, 79, 1.6)}"/>`);
  out.push(`<circle class="iso-line" data-tone="faint" cx="70" cy="3.2" r="0.9"/>`);
  out.push(`</g>`);
  return out.join("");
}

function terminal() {
  return [
    `<path class="iso-line" data-tone="faint" d="M6 15H134"/>`,
    `<circle class="iso-line" data-tone="lo" cx="12" cy="10.5" r="1.6"/><circle class="iso-line" data-tone="lo" cx="17.5" cy="10.5" r="1.6"/><circle class="iso-line" data-tone="lo" cx="23" cy="10.5" r="1.6"/>`,
    `<path class="iso-line" data-tone="faint" data-free="" d="M11 24H70M11 30H52M11 36H88"/>`,
    text("", 11, 49, "❯ kiwi join mc2-7f3k", 6, "mid"),
    `<clipPath id="sh-type"><rect data-part="type" x="6" y="52" width="${(REST.typed * 128).toFixed(2)}" height="10"/></clipPath>`,
    `<g clip-path="url(#sh-type)">${text("", 19, 59, "--relay https://relay.home", 6, "hi")}</g>`,
    `<rect class="sh-cursor" x="11" y="64.6" width="3.2" height="5.6"/>`,
  ].join("");
}

let clips = 0;
function recess(y, x0, x1, z0, z1, r, depth, back = "") {
  const id = `sh-clip-${clips++}`;
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
    const quad = k.pathOf([at([ax, y, az]), at([bx, y, bz]), at([bx, y - depth, bz]), at([ax, y - depth, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))].push(quad);
  });
  const shape = k.pathOf(
    ring.map(([x, z]) => [x, -z]),
    true,
  );
  return [
    `<clipPath id="${id}"><path transform="${faceAt(y)}" d="${shape}"/></clipPath>`,
    `<g clip-path="url(#${id})">`,
    `<path class="iso-top" d="${tops.join("")}"/>`,
    ...sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")),
    `<g transform="${faceAt(y - depth)}"><path class="iso-fill" d="${shape}"/>${back}<path class="iso-line" data-tone="faint" d="${shape}"/></g>`,
    `</g>`,
    `<g transform="${faceAt(y)}"><path class="iso-line" data-tone="lo" d="${shape}"/></g>`,
  ].join("");
}

function cable(route, r = 1.5) {
  return tubePieces(route, r, P, { maxLength: 400 })
    .map((piece) => tubeSvg(piece, { tone: "lo" }))
    .join("");
}

function plug(point, dir) {
  const [x, y, z] = point;
  const shell = dir > 0 ? plan(x - 6, y - 3, x, y + 3, 1.2) : plan(x, y - 3, x + 6, y + 3, 1.2);
  return S(slab(shell, z - 2.4, 4.8, 3, 0.4), { tone: "mid" });
}

function door() {
  const { x, y, w, d, h } = DOOR;
  const face = y + d;
  const out = [`<path class="iso-halo" d="${k.haloOf(DOOR, 0, h, P)}"/>`, feet(DOOR, 5, 0, 3, 2)];
  out.push(S(slab(DOOR, 2, h - 2, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(DOOR, h - 4, P, 4), { tone: "faint" }) }));
  out.push(L(Array.from({ length: 6 }, (_, i) => k.planOutline(plan(x + 8 + i * 5, y + 8, x + 10 + i * 5, y + d - 10, 1), h, P, 3)).join(""), { tone: "faint" }));
  out.push(screws(k.corners(DOOR, 4), h, 1.2));
  const panel = [x + 6, x + w - 6, 5, h - 7];
  out.push(L(onY(face, panel[0], panel[1], panel[2], panel[3], 1.6), { tone: "lo" }));
  out.push(L(onY(face, panel[0] + 2.4, panel[1] - 2.4, panel[2] + 2.4, panel[3] - 2.4, 1), { tone: "faint" }));
  for (const z of [panel[2] + 4, panel[3] - 6]) out.push(S(k.cylinder(panel[0] - 0.6, face + 1.2, 1.2, z, 3.4, P, 12), { tone: "mid" }));
  const hx = panel[1] - 7;
  out.push(S(slab(plan(hx - 3, face, hx + 3, face + 1, 0.4), 13, 9, 2), { tone: "mid" }));
  out.push(S(slab(plan(hx - 1.2, face + 1, hx + 1.2, face + 3.4, 0.4), 18.6, 2, 2), { tone: "mid" }));
  out.push(D([at([hx - 1.8, face + 1, 14.6]), at([hx + 1.8, face + 1, 14.6])], { size: 0.4 }));
  const shackle = G.fillet(
    [
      [hx - 2.6, face + 2.4, 14],
      [hx - 2.6, face + 2.4, 21],
      [hx + 2.6, face + 2.4, 21],
      [hx + 2.6, face + 2.4, 14],
    ],
    2.4,
    8,
  );
  out.push(
    tubePieces(shackle, 0.75, P, { maxLength: 400 })
      .map((piece) => tubeSvg(piece, { tone: "hi" }))
      .join(""),
  );
  const body = plan(hx - 4.4, face + 0.4, hx + 4.4, face + 4.4, 1.4);
  out.push(S(slab(body, 6, 8, 3, 0.4), { tone: "hi" }));
  out.push(L(onY(face + 4.4, hx - 0.5, hx + 0.5, 8, 10.8, 0.5), { tone: "lo" }));
  out.push(D([at([hx, face + 4.4, 11.4])], { size: 0.7, tone: "lo" }));
  const port = [x + w, y + 18, 9];
  out.push(L(onX(port[0], port[1] - 4, port[1] + 4, port[2] - 3, port[2] + 3, 0.8), { tone: "lo" }));
  out.push(D([at([x + w, y + 6, h - 8])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

function server() {
  const { x, y, w, h } = SERVER;
  const out = [`<path class="iso-halo" d="${k.haloOf(SERVER, 0, h, P)}"/>`, feet(SERVER, 8)];
  out.push(S(slab(k.insetPlan(SERVER, 2.5), 2.4, 2, 6), { tone: "lo" }));
  out.push(S(slab(SERVER, 4.4, h - 4.4, 6, 1.2), { tone: "mid", inner: L(k.sideSeam(SERVER, h - 7, P, 6), { tone: "faint" }) }));
  out.push(L(Array.from({ length: 8 }, (_, i) => k.planOutline(plan(x + 16 + i * 7.6, y + 14, x + 19 + i * 7.6, y + 44, 1.5), h, P, 3)).join(""), { tone: "faint" }));
  out.push(screws(k.corners(SERVER, 6), h, 1.4));
  const side = x + w;
  out.push(L(Array.from({ length: 6 }, (_, i) => onX(side, y + 8 + i * 5.2, y + 10.4 + i * 5.2, 26, 48, 1.2)).join(""), { tone: "faint" }));
  out.push(L(onX(side, y + 36, y + 44, 9, 15, 0.8), { tone: "lo" }));
  out.push(L(onX(side, y + 52, y + 62, 10, 18, 1.4), { tone: "lo" }));
  const lines = [
    text("", x + 13, -48.4, "$ bun src/relay/bun.ts", 4.3, "mid"),
    text("", x + 13, -43, "  --data ./relay-data", 4.3, "mid"),
    text("", x + 13, -37.6, "listening on :8787", 4.3, "hi"),
  ].join("");
  out.push(recess(FRONT, x + 8, x + w - 8, 33, 53, 2.6, 2, lines));
  out.push(`<g transform="${faceAt(FRONT)}"><path class="iso-line" data-tone="lo" d="${rect(x + 8, -26, x + 24, -21.6, 2.2)}"/></g>`);
  out.push(D([at([x + 12, FRONT, 23.8]), at([x + 16, FRONT, 23.8])], { size: 0.7, tone: "mid" }));
  out.push(`<g data-part="led">${D([at([x + 20, FRONT, 23.8])], { size: 0.8, tone: "hi" })}</g>`);
  out.push(L(onY(FRONT, x + w - 24, x + w - 10, 12, 16, 1), { tone: "lo" }));
  return out.join("");
}

function cabinet() {
  const { x, y, w, h } = CABINET;
  const out = [`<path class="iso-halo" d="${k.haloOf(CABINET, 0, h, P)}"/>`];
  out.push(S(slab(k.insetPlan(CABINET, 2), 0, 4, 4), { tone: "lo" }));
  out.push(S(slab(CABINET, 4, h - 4, 4, 1), { tone: "mid", inner: L(k.sideSeam(CABINET, h - 2.4, P, 4), { tone: "faint" }) }));
  out.push(screws(k.corners(CABINET, 5), h, 1.2));
  out.push(text(k.topMatrix([x + 12, y + 38], h, P), 0, 0, "relay-data", 4.2, "lo"));
  const side = x + w;
  out.push(L(onX(side, y + 18, y + 42, h - 22, h - 14, 1.4), { tone: "faint" }));
  for (let i = 0; i < SLOTS; i++) {
    const [z0, z1] = slotZ(i);
    out.push(`<path class="iso-fill" d="${onY(FACE, SLOT.x0, SLOT.x1, z0, z1, 1)}"/>`);
    out.push(L(onY(FACE, SLOT.x0, SLOT.x1, z0, z1, 1), { tone: "lo" }));
  }
  return out.join("");
}

function drawerFront(i, lit) {
  const [z0, z1] = slotZ(i);
  const mid = (z0 + z1) / 2;
  const front = FACE + 1.8;
  const pull = (SLOT.x0 + SLOT.x1) / 2 + 8;
  return [
    S(slab(plan(SLOT.x0, FACE, SLOT.x1, front, 0.6), z0, z1 - z0, 2, 0.4), { tone: "mid", lit }),
    S(slab(plan(pull - 8, front, pull - 6, front + 2.4, 0.4), mid - 1, 2, 2), { tone: "mid" }),
    S(slab(plan(pull + 6, front, pull + 8, front + 2.4, 0.4), mid - 1, 2, 2), { tone: "mid" }),
    S(slab(plan(pull - 8, front + 2.4, pull + 8, front + 3.8, 0.6), mid - 1.4, 2.8, 2, 0.3), { tone: lit ? "hi" : "mid", lit }),
    L(onY(front, SLOT.x0 + 4, SLOT.x0 + 26, mid - 3.4, mid + 3.4, 0.8), { tone: lit ? "lit" : "lo" }),
    text(faceAt(front), SLOT.x0 + 5.6, -(mid - 1.6), REST.drawers[i].label, 4, lit ? "hi" : "mid", " data-label"),
    D([at([SLOT.x0 + 2.2, front, mid]), at([SLOT.x1 - 2.2, front, mid])], { size: 0.4 }),
  ].join("");
}

function card(i) {
  const [, z1] = slotZ(i);
  const cx = (SLOT.x0 + SLOT.x1) / 2;
  const box = plan(cx - 16, FACE + 4, cx + 16, FACE + 5, 0.3);
  const top = z1 + 0.2;
  return (
    S(slab(box, top - 12, 12, 2), { tone: "hi" }) +
    L(k.segment([cx - 13, FACE + 5, top - 2.4], [cx + 6, FACE + 5, top - 2.4], P) + k.segment([cx - 13, FACE + 5, top - 4.4], [cx + 1, FACE + 5, top - 4.4], P), { tone: "lo", free: true })
  );
}

function drawers() {
  const out = [];
  for (let i = SLOTS - 1; i >= 0; i--) {
    const d = REST.drawers[i];
    const move = k.translateAlong(P, [0, d.out, 0]);
    const hidden = d.shown <= 0.001 ? ' display="none"' : "";
    const cardMove = k.translateAlong(P, [0, d.out - 10, d.drop * 24]);
    out.push(`<g data-drawer="${i}" opacity="${d.shown.toFixed(3)}"${hidden}>`);
    out.push(`<g data-part="body">${drawerBody(i, d.out)}</g>`);
    out.push(`<g data-part="card" transform="${cardMove}" opacity="${d.card.toFixed(3)}">${card(i)}</g>`);
    out.push(`<g data-part="front" transform="${move}">`);
    out.push(`<g data-part="plain">${drawerFront(i, false)}</g>`);
    out.push(`<g data-part="glow" opacity="${d.lit.toFixed(3)}">${drawerFront(i, true)}</g>`);
    out.push(`</g></g>`);
  }
  return out.join("");
}

function bead(leg) {
  const on = REST.bead?.leg === leg;
  const point = on ? at(REST.bead.point) : [0, 0];
  return `<g data-bead="${leg}" class="iso-wire" data-tone="lit"${on ? "" : ' display="none"'}><circle class="iso-wire-end" cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="2.2"/></g>`;
}

export default function figure() {
  const body = [
    `<style>.sh-cursor{fill:var(--anatomy-mid)}</style>`,
    laptop(CLIENT),
    plug([PORT[0] + 6, PORT[1], PORT[2]], 1),
    cable(ROUTES.a),
    bead("a"),
    door(),
    plug(ROUTES.b[0], 1),
    cable(ROUTES.b),
    bead("b"),
    server(),
    plug(ROUTES.c[0], 1),
    cable(ROUTES.c),
    bead("c"),
    cabinet(),
    drawers(),
  ];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "A self-hosted relay at home. A laptop's terminal runs kiwi join with --relay pointing at your own address. Its cable comes in through a small box with a padlocked front door, the TLS proxy, then reaches a small server whose screen shows bun src/relay/bun.ts --data ./relay-data, listening on port 8787. Beside it stands a filing cabinet labelled relay-data with one drawer per channel and a top drawer for people: a new drawer slides in when a channel is created, the drawer being written to opens and takes a card, and a drawer is pulled out and gone when its channel is closed.",
    body,
  });
}
