import * as k from "../../anatomy/iso-kit.js";

export const WIDTH = 960;
export const HEIGHT = 530;

export const COUNTER = { x: -146, y: -52, w: 292, d: 110, r: 6 };
export const TOP = 11;
export const BOX = { x: -45, y: -48, w: 90, d: 70, r: 4 };
export const BOX_TOP = 71;
export const FRONT = BOX.y + BOX.d;
export const LANE = 37;
export const BELT = { y0: 25, y1: 49 };
export const BELT_Z = 15.5;
export const ENV = { w: 32, d: 19, h: 1.3 };
export const FEED_IN = { x: -142, y: 21, w: 36, d: 32, r: 2.4 };
export const FEED_OUT = { x: 106, y: 21, w: 36, d: 32, r: 2.4 };
export const PAN = { x: -85, y: 26.5, w: 38, d: 21, r: 1.8 };
export const SCALE = { x: -84, w: 36, y: 49, d: 12, z0: 4, z1: 18 };
export const BIN = { x: 6, y: 66, w: 44, d: 36, r: 2 };
export const BIN_H = 12;
export const DIAL = { x: PAN.x + PAN.w / 2, z: 11, r: 5.6 };
export const STAMP = { x: -24, y: LANE, r: 6.4, pad: 21.4 };
export const LAMP = { x: 2, y: LANE };
export const KICK = { x: 28, travel: 19, gap: 2.1 };
export const TRAY = { x: -138, y: -44, w: 46, d: 30, r: 2 };
export const CLIP = { x: 60, y: -44, w: 44, d: 40, r: 2.4 };
export const SENDER = { x: -292, y: -80 };
export const RECEIVER = { x: 156, y: -14 };
export const LAPTOP = { w: 140, d: 96, h: 7, lid: 90, tilt: 12 };

export const MARK = [ENV.w / 2 - 7, 1.5];
export const STOPS = { start: FEED_IN.x + FEED_IN.w - ENV.w / 2 - 0.5, pan: PAN.x + PAN.w / 2, stamp: STAMP.x - MARK[0], lamp: LAMP.x, kick: KICK.x, out: FEED_OUT.x + ENV.w / 2 + 0.5 };
export const LANDING = [KICK.x, BIN.y + BIN.d / 2, 2.6];

export const P = k.fitProjection(
  [
    ...k.boxCorners({ x: SENDER.x, y: SENDER.y, w: LAPTOP.w, d: LAPTOP.d }, 0, 0),
    [SENDER.x, SENDER.y - 18, LAPTOP.lid + 9],
    ...k.boxCorners({ x: RECEIVER.x, y: RECEIVER.y, w: LAPTOP.w, d: LAPTOP.d }, 0, 0),
    [RECEIVER.x + LAPTOP.w, RECEIVER.y - 18, LAPTOP.lid + 9],
    ...k.boxCorners(BIN, 0, BIN_H),
  ],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 62 },
);

export function planeMatrix(origin, u, v, projection) {
  const o = k.iso(origin, projection);
  const a = k.iso([origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]], projection);
  const b = k.iso([origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]], projection);
  const r = (value) => Math.round(value * 1000) / 1000;
  return `matrix(${r(a[0] - o[0])} ${r(a[1] - o[1])} ${r(b[0] - o[0])} ${r(b[1] - o[1])} ${r(o[0])} ${r(o[1])})`;
}

export function lidFrame(at) {
  const t = (LAPTOP.tilt * Math.PI) / 180;
  const a = [0, Math.cos(t), Math.sin(t)];
  const v = [0, -Math.sin(t), Math.cos(t)];
  const o = [at.x, at.y + 5, LAPTOP.h + 2.2];
  return { o, a, u: [1, 0, 0], v };
}

export function screenMatrix(at) {
  const F = lidFrame(at);
  const top = [F.o[0] + F.v[0] * LAPTOP.lid, F.o[1] + F.v[1] * LAPTOP.lid, F.o[2] + F.v[2] * LAPTOP.lid];
  return planeMatrix(top, F.u, [-F.v[0], -F.v[1], -F.v[2]], P);
}

export const faceMatrix = () => k.sideMatrix([0, FRONT], 0, P, "left");

export const PERIOD = 11;
export const REST_T = 5.3;
export const PHRASES = ["ship it after tests", "rebase on main first", "docs look good"];
export const CIPHER = ["9f3a c10e 77b2 e4d1 0b6c", "41de 08a7 f2c9 3b50 d61e", "c7a0 5e19 e83f 2d47 9a0b", "6b2f d4c8 1a95 70e3 bf26", "e851 3c0d 9b7a 46f2 08cd", "2ad6 f71b 05e8 c943 7e10"];
export const SIZES = { good: 0.55, forged: 0.38 };

const clamp = (value) => Math.min(1, Math.max(0, value));
export const smooth = (a, b, t) => {
  const x = clamp((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const span = (t, a, b, from, to) => from + (to - from) * smooth(a, b, t);

function goodAt(t) {
  let x = span(t, 0.8, 2.0, STOPS.start, STOPS.pan);
  if (t >= 2.8) x = span(t, 2.8, 3.6, STOPS.pan, STOPS.stamp);
  if (t >= 4.2) x = span(t, 4.2, 4.8, STOPS.stamp, STOPS.lamp);
  if (t >= 5.8) x = span(t, 5.8, 7.0, STOPS.lamp, STOPS.out);
  const glow = smooth(1.1, 1.3, t) * (1 - smooth(6.6, 7.0, t));
  return { offset: [x, 0, 0], postmark: smooth(3.82, 3.9, t), glow, onPan: smooth(1.85, 2.0, t) * (1 - smooth(2.8, 2.95, t)), inBin: false };
}

function forgedAt(t) {
  let x = span(t, 3.6, 4.8, STOPS.start, STOPS.pan);
  let z = 0;
  if (t >= 5.8) x = span(t, 5.8, 6.4, STOPS.pan, STOPS.stamp);
  if (t >= 7.0) x = span(t, 7.0, 7.6, STOPS.stamp, STOPS.lamp);
  if (t >= 8.6) x = span(t, 8.6, 9.0, STOPS.lamp, STOPS.kick);
  const reach = KICK.travel - KICK.gap;
  let y = Math.max(kickAt(t) - KICK.gap, 0);
  if (t >= 9.55) {
    const f = clamp((t - 9.55) / 0.45);
    y = reach + (LANDING[1] - LANE - reach) * (1 - (1 - f) * (1 - f));
    z = (LANDING[2] - BELT_Z) * f * f;
  }
  const glow = smooth(6.6, 7.0, t);
  return { offset: [x, y, z], postmark: smooth(6.62, 6.7, t), glow, onPan: smooth(4.65, 4.8, t) * (1 - smooth(5.8, 5.95, t)), inBin: t >= 9.0 };
}

export function kickAt(t) {
  return KICK.travel * smooth(9.0, 9.55, t) * (1 - smooth(9.75, 10.3, t));
}

export function stampAt(t) {
  const press = (c) => smooth(c - 0.3, c, t) * (1 - smooth(c + 0.12, c + 0.45, t));
  return (STAMP.pad - BELT_Z - ENV.h) * Math.max(press(3.9), press(6.7));
}

export function poseAt(time) {
  const loop = Math.floor(time / PERIOD);
  const t = time - loop * PERIOD;
  const good = goodAt(t);
  const forged = forgedAt(t);
  const load = good.onPan * SIZES.good + forged.onPan * SIZES.forged;
  const checks = loop * 2 + (t >= 4.8 ? 1 : 0) + (t >= 7.6 ? 1 : 0);
  const delivered = loop + (t >= 7.0 ? 1 : 0);
  return {
    loop,
    t,
    good,
    forged,
    load,
    pan: 0.8 * Math.min(1, good.onPan + forged.onPan),
    needle: -120 + 240 * load,
    stamp: stampAt(t),
    kick: kickAt(t),
    typed: smooth(0, 0.8, t) * (1 - smooth(PERIOD - 0.5, PERIOD, t)),
    phrase: PHRASES[((loop % 3) + 3) % 3],
    checks,
    delivered,
    scroll: 1 - smooth(7.0, 7.45, t),
    oldShown: t < 10.0,
    oldGlow: 1 - smooth(1.1, 1.35, t),
  };
}

export function rowsAt(delivered) {
  return [3, 2, 1].map((back) => PHRASES[(((delivered - back) % 3) + 3) % 3]);
}

export function cipherAt(checks) {
  return [2, 1, 0].map((back) => CIPHER[(((checks - back) % CIPHER.length) + CIPHER.length) % CIPHER.length]);
}

export const REST = (() => {
  const pose = poseAt(REST_T);
  return { ...pose, rows: rowsAt(pose.delivered), cipher: cipherAt(pose.checks) };
})();

export function rodSvg(travel) {
  if (travel < 0.05) return "";
  const plan = { x: KICK.x - 1.4, y: FRONT + 1.4, w: 2.8, d: travel, r: Math.min(0.6, travel / 2) };
  return k.solidSvg(k.slabOf(plan, BELT_Z + 1.2, 2.4, P, 2), { tone: "hi" });
}
