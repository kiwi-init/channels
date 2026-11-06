import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";

export const W = 960;
export const H = 560;

const DEG = Math.PI / 180;

export const BENCH = { x: -254, y: -274, w: 454, d: 560, r: 40 };
export const BENCH_RADII = [40, 110, 230, 110];

export function benchRing(inset = 0, steps = 6) {
  const { x, y, w, d } = BENCH;
  const corners = [
    [x + w, y, -90],
    [x + w, y + d, 0],
    [x, y + d, 90],
    [x, y, 180],
  ];
  const out = [];
  corners.forEach(([cx, cy, start], index) => {
    const r = Math.max(1, [BENCH_RADII[1], BENCH_RADII[2], BENCH_RADII[3], BENCH_RADII[0]][index] - inset);
    const ox = cx + (index === 0 || index === 1 ? -r - inset : r + inset);
    const oy = cy + (index === 1 || index === 2 ? -r - inset : r + inset);
    const count = Math.max(4, Math.round((steps * r) / 40));
    for (let step = 0; step <= count; step++) {
      const angle = ((start + (90 * step) / count) * Math.PI) / 180;
      out.push([ox + r * Math.cos(angle), oy + r * Math.sin(angle)]);
    }
  });
  return out;
}
export const BENCH_T = 12;
export const FOOT_H = 7;

export const RELAY = { x: -45, y: -35, w: 90, d: 70, r: 3 };
export const RELAY_Z = 4;
export const RELAY_TOP = 56;
export const RELAY_FRONT = RELAY.y + RELAY.d;
export const RELAY_SIDE = RELAY.x + RELAY.w;
export const PORT_Z = 14;

export const CABLE_R = 1.8;

export const frameOf = (centre, right, toward) => ({ c: centre, r: right, t: toward });
export const FACING_X = (centre) => frameOf(centre, [0, -1, 0], [1, 0, 0]);
export const FACING_Y = (centre) => frameOf(centre, [1, 0, 0], [0, 1, 0]);

export function local(F, [w, d, z]) {
  return [F.c[0] + F.r[0] * w + F.t[0] * d, F.c[1] + F.r[1] * w + F.t[1] * d, F.c[2] + z];
}

export function planIn(F, { w0, w1, d0, d1, r = 0 }) {
  const a = local(F, [w0, d0, 0]);
  const b = local(F, [w1, d1, 0]);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]), d: Math.abs(a[1] - b[1]), r };
}

export const LAPTOP = { F: FACING_X([-100, 198, 0]), w: 140, d: 96, z0: 2, z1: 9.5, lid: { w: 140, h: 92, t: 3.4, tilt: 12 * DEG } };
export const CODEX = { F: FACING_Y([20, -192, 0]), w: 140, d: 96, z0: 2, z1: 9.5, lid: { w: 140, h: 92, t: 3.4, tilt: 12 * DEG } };
export const MONITOR = { F: FACING_X([-207, 0, 0]), w: 160, h: 94, z0: 44, t: 5 };
export const MINI = { x: -196, y: 40, w: 50, d: 50, r: 7, z0: 1.5, h: 15 };
export const KEYBOARD = { x: -140, y: -64, w: 42, d: 110, r: 4 };
export const DOCK = { x: 148, y: -10, w: 32, d: 48, r: 5 };
export const PHONE = { F: FACING_X([163, 14, 0]), w: 40, h: 80, t: 4.4, tilt: 16 * DEG, z0: 6 };

export const P = k.fitProjection(
  [
    ...benchRing().flatMap(([x, y]) => [
      [x, y, 0],
      [x, y, -BENCH_T - FOOT_H],
    ]),
    [-212, -80, MONITOR.z0 + MONITOR.h],
    [-212, 80, MONITOR.z0 + MONITOR.h],
    [-70, -280, 102],
    [-170, 128, 102],
  ],
  W,
  H,
  { pad: 10 },
);

export const at = (point) => k.iso(point, P);
const round = (value) => Math.round(value * 1000) / 1000;

export function planeMatrix(origin, right, down) {
  const o = at(origin);
  const u = at([origin[0] + right[0], origin[1] + right[1], origin[2] + right[2]]);
  const v = at([origin[0] + down[0], origin[1] + down[1], origin[2] + down[2]]);
  return `matrix(${round(u[0] - o[0])} ${round(u[1] - o[1])} ${round(v[0] - o[0])} ${round(v[1] - o[1])} ${round(o[0])} ${round(o[1])})`;
}

export function lidOf(device) {
  const { F, d, z1, lid } = device;
  const up = [-Math.sin(lid.tilt) * F.t[0], -Math.sin(lid.tilt) * F.t[1], Math.cos(lid.tilt)];
  const normal = [Math.cos(lid.tilt) * F.t[0], Math.cos(lid.tilt) * F.t[1], Math.sin(lid.tilt)];
  const hinge = local(F, [0, -d / 2 + 2.4, z1 + 1.2]);
  return { up, normal, down: up.map((value) => -value), hinge, right: F.r };
}

export function screenPlane(origin, right, down, w, h) {
  return { origin, right, down, w, h, matrix: planeMatrix(origin, right, down) };
}

const offset = (point, dir, by) => [point[0] + dir[0] * by, point[1] + dir[1] * by, point[2] + dir[2] * by];

function lidScreen(device, inset) {
  const L = lidOf(device);
  const face = offset(L.hinge, L.normal, 0);
  const top = offset(face, L.up, device.lid.h - inset.top);
  const origin = offset(top, L.right, -device.lid.w / 2 + inset.side);
  return screenPlane(origin, L.right, L.down, device.lid.w - inset.side * 2, device.lid.h - inset.top - inset.bottom);
}

export const SCREENS = {
  laptop: lidScreen(LAPTOP, { side: 6, top: 6, bottom: 10 }),
  codex: lidScreen(CODEX, { side: 6, top: 6, bottom: 10 }),
  claude: screenPlane(local(MONITOR.F, [-MONITOR.w / 2 + 5, MONITOR.t / 2, MONITOR.z0 + MONITOR.h - 5]), MONITOR.F.r, [0, 0, -1], MONITOR.w - 10, MONITOR.h - 14),
  phone: (() => {
    const { F, w, h, tilt, z0 } = PHONE;
    const up = [-Math.sin(tilt), 0, Math.cos(tilt)];
    const foot = local(F, [0, PHONE.t / 2, z0]);
    const top = offset(foot, up, h - 7);
    return screenPlane(
      offset(top, F.r, -w / 2 + 3),
      F.r,
      up.map((value) => -value),
      w - 6,
      h - 15,
    );
  })(),
  relay: screenPlane([RELAY.x + 8, RELAY_FRONT, 52], [1, 0, 0], [0, 0, -1], 63, 25),
};

export const PORTS = {
  laptop: { relay: [14, RELAY_FRONT, PORT_Z], axis: [0, 1, 0] },
  claude: { relay: [-28, RELAY_FRONT, PORT_Z], axis: [0, 1, 0] },
  phone: { relay: [RELAY_SIDE, 14, PORT_Z], axis: [1, 0, 0] },
  codex: { relay: [RELAY_SIDE, -16, PORT_Z], axis: [1, 0, 0] },
};

export const DEVICE_PORTS = {
  laptop: { at: [-120, 198 - 70, 5.8], axis: [0, -1, 0], kind: "usb" },
  claude: { at: [MINI.x + MINI.w, 65, 8.5], axis: [1, 0, 0], kind: "rj" },
  phone: { at: [DOCK.x, 14, 4.2], axis: [-1, 0, 0], kind: "usb" },
  codex: { at: [CODEX.F.c[0] + 70, -214, 5.8], axis: [1, 0, 0], kind: "usb" },
};

export const PLUG = { rj: { body: 7, boot: 6, bw: 8, bh: 6.4, tw: 5.6, th: 4.6 }, usb: { body: 6.5, boot: 5.5, bw: 7.4, bh: 3.2, tw: 5, th: 3.2 } };
export const plugLength = (kind) => PLUG[kind].body + PLUG[kind].boot;

const ROUTES_RAW = {
  laptop: (a, b) => [a, [a[0], a[1] + 6, a[2]], [a[0], a[1] + 14, CABLE_R], [a[0], b[1] - 16, CABLE_R], [b[0], b[1] - 16, CABLE_R], [b[0], b[1] - 5, b[2]], b],
  claude: (a, b) => [a, [a[0], a[1] + 6, a[2]], [a[0], b[1], CABLE_R], [b[0] + 14, b[1], CABLE_R], [b[0] + 5, b[1], b[2]], b],
  phone: (a, b) => [a, [a[0] + 6, a[1], a[2]], [a[0] + 14, a[1], CABLE_R], [b[0] - 10, b[1], CABLE_R], [b[0] - 4, b[1], b[2]], b],
  codex: (a, b) => [a, [a[0] + 6, a[1], a[2]], [a[0] + 14, a[1], CABLE_R], [124, a[1], CABLE_R], [124, b[1], CABLE_R], [b[0] + 10, b[1], CABLE_R], [b[0] + 4, b[1], b[2]], b],
};

function routeOf(name) {
  const port = PORTS[name];
  const device = DEVICE_PORTS[name];
  const a = offset(port.relay, port.axis, plugLength("rj"));
  const b = offset(device.at, device.axis, plugLength(device.kind));
  const raw = ROUTES_RAW[name](a, b);
  const points = G.resample(G.fillet(raw, 6, 9), 1.2);
  return { points, length: G.pathLength(points) };
}

export const CABLES = ["claude", "codex", "laptop", "phone"];
export const ROUTES = Object.fromEntries(CABLES.map((name) => [name, routeOf(name)]));

export const PACKET = { w: 14, d: 14, h: 9.4, lock: { w: 9, d: 3.4, h: 7.2, r: 2.9, tube: 0.95, lift: 4.2 } };

export function packetAt(name, s) {
  const route = ROUTES[name];
  const point = G.pointAlong(route.points, Math.max(0, Math.min(route.length, s)));
  return [point[0], point[1], point[2] + CABLE_R + 0.8];
}

export const MESSAGES = [
  { from: "laptop", name: "ana", text: "ship it once tests pass?" },
  { from: "claude", name: "claude", text: "tests green. merging." },
  { from: "codex", name: "codex", text: "changelog updated." },
  { from: "phone", name: "ana", text: "thanks, both." },
];

export const T = { period: 6.2, typeAt: 0.5, perChar: 0.055, inbound: 1.05, hold: 0.85, outbound: 1.15, unlock: 0.3, fade: 0.45, scroll: 0.5 };
export const LOOP = T.period * MESSAGES.length;

export const messageOf = (m) => MESSAGES[((m % MESSAGES.length) + MESSAGES.length) % MESSAGES.length];

export function timesOf(m) {
  const start = m * T.period + T.typeAt;
  const send = start + messageOf(m).text.length * T.perChar + 0.35;
  const atRelay = send + T.inbound;
  const leave = atRelay + T.hold;
  const arrive = leave + T.outbound;
  return { start, send, atRelay, leave, arrive };
}

export const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

export const STILL = (() => {
  const times = timesOf(0);
  return Math.round((times.leave + 0.58 * T.outbound) * 100) / 100;
})();

const TRIM = { start: 9, end: 11 };

export function packetState(name, t) {
  const m = Math.floor((t - T.typeAt) / T.period);
  for (const index of [m, m - 1]) {
    const times = timesOf(index);
    const from = messageOf(index).from;
    const L = ROUTES[name].length;
    if (from === name) {
      if (t < times.send || t > times.atRelay) continue;
      const p = easeInOut((t - times.send) / T.inbound);
      const s = L - TRIM.end - p * (L - TRIM.end - TRIM.start);
      const fadeIn = smooth((t - times.send) / 0.18);
      const fadeOut = 1 - smooth((t - times.atRelay + 0.16) / 0.16);
      return { s, opacity: Math.min(fadeIn, fadeOut), open: 0 };
    }
    if (t < times.leave || t > times.arrive + T.unlock + T.fade + 0.2) continue;
    const p = easeInOut((t - times.leave) / T.outbound);
    const s = TRIM.start + p * (L - TRIM.end - TRIM.start);
    const fadeIn = smooth((t - times.leave) / 0.18);
    const open = smooth((t - times.arrive) / T.unlock);
    const fadeOut = 1 - smooth((t - times.arrive - T.unlock - 0.1) / T.fade);
    return { s, opacity: Math.min(fadeIn, fadeOut), open };
  }
  return { s: TRIM.start, opacity: 0, open: 0 };
}

export function relayState(t) {
  const m = Math.floor((t - T.typeAt) / T.period);
  let held = 0;
  for (const index of [m, m - 1]) {
    const times = timesOf(index);
    if (t >= times.atRelay - 0.1 && t <= times.leave + 0.1) held = Math.max(held, Math.min(smooth((t - times.atRelay + 0.1) / 0.15), 1 - smooth((t - times.leave) / 0.15)));
  }
  return { held };
}

function hash(value) {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const HEX = "0123456789abcdef";
const PAD = "\u00a0";
export function cipherOf(m, tick = -1) {
  let out = "";
  for (let i = 0; i < 14; i++) {
    if (i === 4 || i === 9) {
      out += " ";
      continue;
    }
    out += HEX[hash(m * 131 + i * 7919 + (tick + 1) * 104729) % 16];
  }
  return out;
}

export function wrap(text, cols) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > cols) {
      lines.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

export const LAYOUT = {
  laptop: { kind: "chat", x: 26, top: 22, rowH: 9.6, em: 7.6, cap: 5, cols: 17, clip: [21, 14.8, 106, 49.2], compose: { x: 27, y: 71.8, em: 6.2, box: [24, 65, 100, 9] } },
  phone: { kind: "chat", x: 3, top: 15.4, rowH: 5.6, em: 4, cap: 8, cols: 12, clip: [1, 11.2, 32, 45.8], compose: { x: 3.6, y: 62, em: 3.2, box: [2, 58, 30, 5.4] } },
  claude: { kind: "term", x: 6, top: 27, rowH: 9.2, em: 7.2, cap: 5, cols: 29, clip: [2, 20.2, 146, 45.8], prompt: "●" },
  codex: { kind: "term", x: 6, top: 26, rowH: 9, em: 7, cap: 5, cols: 25, clip: [2, 19.4, 124, 44.6], prompt: "•" },
  relay: { kind: "cipher", x: 4.5, top: 8.6, rowH: 7, em: 6.2, cap: 3, clip: [0, 3.6, 63, 21.4] },
};

export function rowsOf(screen, m) {
  const layout = LAYOUT[screen];
  const message = messageOf(m);
  if (layout.kind === "cipher") return [{ text: cipherOf(m), tone: "hi", m }];
  if (layout.kind === "chat") return [{ text: message.name, tone: "mid", m }, ...wrap(message.text, layout.cols).map((text) => ({ text, tone: "hi", m }))];
  if (message.from === screen) return wrap(message.text, layout.cols - 2).map((text, index) => ({ text: (index ? PAD + PAD : layout.prompt + PAD) + text, tone: "hi", m, own: true }));
  return [{ text: ">" + PAD + message.name, tone: "mid", m }, ...wrap(message.text, layout.cols - 2).map((text) => ({ text: PAD + PAD + text, tone: "hi", m }))];
}

function arrivalOf(screen, m) {
  const times = timesOf(m);
  if (screen === "relay") return times.atRelay;
  const from = messageOf(m).from;
  if (from === screen) return LAYOUT[screen].kind === "term" ? times.start : times.send;
  return times.arrive;
}

export function feedState(screen, t) {
  const layout = LAYOUT[screen];
  const m = Math.floor((t - T.typeAt) / T.period);
  const rows = [];
  let shift = 0;
  for (let index = m - 6; index <= m + 1; index++) {
    const arrival = arrivalOf(screen, index);
    if (arrival > t) continue;
    const list = rowsOf(screen, index);
    const age = t - arrival;
    if (age < T.scroll) shift += list.length * layout.rowH * (1 - smooth(age / T.scroll));
    const times = timesOf(index);
    let chars = Infinity;
    if (list[0]?.own) chars = Math.floor(((t - times.start) / (times.send - 0.35 - times.start)) * messageOf(index).text.length);
    let used = 0;
    for (const row of list) {
      const body = row.own ? row.text.slice(2) : row.text;
      let text = row.text;
      if (row.own) {
        const take = Math.max(0, Math.min(body.length, chars - used));
        text = row.text.slice(0, 2) + body.slice(0, take);
        used += body.length + 1;
      }
      if (screen === "relay" && age < 0.55) text = cipherOf(index, Math.floor(t / 0.06));
      rows.push({ text, tone: row.tone, opacity: smooth(age / 0.3), key: `${index}` });
    }
  }
  const visible = rows.slice(-(layout.cap + 4));
  const n = visible.length;
  return visible.map((row, index) => ({ ...row, y: layout.top + (layout.cap - (n - index)) * layout.rowH + shift }));
}

export function composeState(screen, t) {
  const layout = LAYOUT[screen];
  if (!layout.compose) return null;
  const m = Math.floor((t - T.typeAt) / T.period);
  for (const index of [m, m + 1]) {
    const message = messageOf(index);
    if (message.from !== screen) continue;
    const times = timesOf(index);
    if (t < times.start - 0.3 || t >= times.send) continue;
    const chars = Math.max(0, Math.floor((t - times.start) / T.perChar));
    return { text: message.text.slice(0, chars), caret: Math.floor(t / 0.5) % 2 === 0 || chars < message.text.length };
  }
  return { text: "", caret: Math.floor(t / 0.5) % 2 === 0 };
}
