import * as k from "../../anatomy/iso-kit.js";
import { P, CODE, REEL, ROUTE_A, ROUTE_B, CABLE_R, LIFT, TOUR } from "./model.js";

const HEX = "0123456789abcdef";
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInOut = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

function lengths(route) {
  const out = [0];
  for (let i = 1; i < route.length; i++) {
    const [ax, ay, az] = route[i - 1];
    const [bx, by, bz] = route[i];
    out.push(out[i - 1] + Math.hypot(bx - ax, by - ay, bz - az));
  }
  return out;
}

function track(route) {
  const lift = route.map(([x, y, z]) => [x, y, z + CABLE_R + LIFT]);
  const sums = lengths(lift);
  const total = sums[sums.length - 1];
  return {
    total,
    at(s) {
      const d = Math.min(total, Math.max(0, s));
      let i = 1;
      while (i < sums.length - 1 && sums[i] < d) i++;
      const t = (d - sums[i - 1]) / (sums[i] - sums[i - 1] || 1);
      const a = lift[i - 1];
      const b = lift[i];
      return k.iso([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], P);
    },
  };
}

const A = track(ROUTE_A);
const B = track(ROUTE_B);
const DWELL = 46;

function journey(f, outbound) {
  const total = A.total + DWELL + B.total;
  const s = f * total;
  const fade = (d, lo, hi) => smooth(0, lo, d) * (1 - smooth(hi - 12, hi, d));
  if (outbound) {
    if (s < A.total) return { at: A.at(s), alpha: fade(s, 10, A.total), inside: false };
    if (s < A.total + DWELL) return { at: A.at(A.total), alpha: 0, inside: true };
    const d = s - A.total - DWELL;
    return { at: B.at(d), alpha: fade(d, 12, B.total), inside: false };
  }
  if (s < B.total) return { at: B.at(B.total - s), alpha: fade(s, 10, B.total), inside: false };
  if (s < B.total + DWELL) return { at: B.at(0), alpha: 0, inside: true };
  const d = s - B.total - DWELL;
  return { at: A.at(A.total - d), alpha: fade(d, 12, A.total), inside: false };
}

function press(t) {
  const d = t - TOUR.press;
  if (d < 0) return 0;
  if (d < 0.09) return smooth(0, 0.09, d);
  if (d < 0.26) return 1;
  const r = d - 0.26;
  return Math.exp(-r * 9) * Math.cos(r * 16);
}

function pose(t) {
  const ask = (t - TOUR.ask[0]) / (TOUR.ask[1] - TOUR.ask[0]);
  const keys = (t - TOUR.keys[0]) / (TOUR.keys[1] - TOUR.keys[0]);
  const reels = [];
  for (let i = 0; i < 6; i++) {
    const target = Number(CODE[i]);
    const p = (target + 20) * easeOut((t - TOUR.roll[0]) / (0.85 + i * 0.13));
    reels.push(p % 10);
  }
  const shown = smooth(TOUR.roll[0] - 0.05, TOUR.roll[0] + 0.15, t) * (1 - smooth(TOUR.end - 0.7, TOUR.end - 0.1, t));
  const pressed = press(t);
  const pressing = t >= TOUR.press && t < TOUR.keys[0] + 0.1;
  const cardIn = smooth(TOUR.card, TOUR.card + 0.45, t) * (1 - smooth(TOUR.joined - 0.1, TOUR.joined + 0.5, t));
  const cx = 104 - (104 - 61) * easeInOut((t - TOUR.cursor[0]) / (TOUR.cursor[1] - TOUR.cursor[0])) + 43 * easeInOut((t - TOUR.joined - 0.3) / 1.4);
  const cy = 30 + (63 - 30) * easeInOut((t - TOUR.cursor[0]) / (TOUR.cursor[1] - TOUR.cursor[0])) - 33 * easeInOut((t - TOUR.joined - 0.3) / 1.4);
  const joined = smooth(TOUR.joined, TOUR.joined + 0.4, t) * (1 - smooth(TOUR.end - 0.7, TOUR.end - 0.1, t));
  return {
    ask: ask > 0 && ask < 1 ? journey(easeInOut(ask), true) : null,
    keys: keys > 0 && keys < 1 ? journey(easeInOut(keys), false) : null,
    reels,
    shown,
    codeLit: shown > 0 && t < TOUR.press,
    pressed,
    pressing,
    cardIn,
    cursor: [cx, cy],
    joined,
    joinedLit: t >= TOUR.joined && t < TOUR.joined + 2.4,
    done: t >= TOUR.joined,
  };
}

function rest() {
  return {
    ask: null,
    keys: null,
    reels: [...CODE].map(Number),
    shown: 1,
    codeLit: true,
    pressed: 0,
    pressing: false,
    cardIn: 1,
    cursor: [66, 68],
    joined: 0,
    joinedLit: false,
    done: false,
  };
}

function mount(fig) {
  const svg = fig.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const get = (sel) => svg.querySelector(sel);
  const reelEls = { t: [], a: [] };
  for (const side of ["t", "a"]) for (let i = 0; i < 6; i++) reelEls[side].push(get(`[data-reel="${side}${i}"]`));
  const codes = [...svg.querySelectorAll("[data-code]")];
  const packets = { ask: get('[data-packet="ask"]'), keys: get('[data-packet="keys"]') };
  const btn = get('[data-part="btn"]');
  const card = get('[data-part="card"]');
  const cursor = get('[data-part="cursor"]');
  const joined = get('[data-part="joined"]');
  const label = get('[data-part="ask-t"]');
  const member = get('[data-part="member"]');
  const notice = get('[data-part="notice"]');
  const cipher = get('[data-part="cipher"] text');
  const leds = [...svg.querySelectorAll("[data-led]")];
  const lineOf = { t: REEL.term.size * 1.1, a: REEL.app.size * 1.1 };
  const cache = new Map();
  const write = (el, name, value) => {
    if (!el) return;
    const key = el;
    const seen = cache.get(key) ?? {};
    if (seen[name] === value) return;
    seen[name] = value;
    cache.set(key, seen);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  const flag = (el, name, on) => write(el, name, on ? "" : null);
  const btnBox = { cx: 61, cy: 63 };
  let scramble = 0;

  function apply(s, dt) {
    for (const side of ["t", "a"]) {
      reelEls[side].forEach((el, i) => write(el, "transform", `translate(0 ${(-s.reels[i] * lineOf[side]).toFixed(2)})`));
    }
    for (const el of codes) {
      write(el, "opacity", s.shown >= 1 ? null : s.shown.toFixed(3));
      flag(el, "data-lit", s.codeLit);
      flag(el, "data-done", s.done);
    }
    for (const [name, p] of Object.entries({ ask: s.ask, keys: s.keys })) {
      const el = packets[name];
      if (!p || p.alpha <= 0.001) {
        write(el, "opacity", "0");
        continue;
      }
      write(el, "transform", `translate(${p.at[0].toFixed(1)} ${p.at[1].toFixed(1)})`);
      write(el, "opacity", p.alpha.toFixed(3));
    }
    const inside = (s.ask && s.ask.inside) || (s.keys && s.keys.inside);
    scramble += dt;
    if (inside && scramble > 0.07 && cipher) {
      scramble = 0;
      const pick = () => HEX[Math.floor(Math.random() * 16)] + HEX[Math.floor(Math.random() * 16)];
      cipher.textContent = `${pick()} ${pick()} ${pick()} ${pick()}`;
    }
    flag(leds[1], "data-on", !!inside);
    flag(leds[2], "data-on", !!(s.ask || s.keys));
    const sc = 1 - 0.03 * s.pressed;
    write(btn, "transform", `translate(${(btnBox.cx * (1 - sc)).toFixed(2)} ${(btnBox.cy * (1 - sc) + 1.3 * s.pressed).toFixed(2)}) scale(${sc.toFixed(4)})`);
    flag(btn, "data-lit", s.pressing);
    write(card, "opacity", s.cardIn.toFixed(3));
    write(card, "transform", `translate(0 ${((1 - s.cardIn) * 5).toFixed(2)})`);
    write(cursor, "transform", `translate(${s.cursor[0].toFixed(2)} ${s.cursor[1].toFixed(2)})`);
    write(label, "opacity", s.shown >= 1 ? null : s.shown.toFixed(3));
    write(joined, "opacity", s.joined.toFixed(3));
    flag(joined, "data-lit", s.joinedLit);
    write(member, "opacity", s.joined.toFixed(3));
    write(notice, "opacity", s.joined.toFixed(3));
  }

  let frame = 0;
  let last = 0;
  let clock = 0;
  let visible = false;

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock = (clock + dt) % TOUR.end;
    apply(pose(clock), dt);
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }
  function run() {
    if (still.matches) {
      apply(rest(), 0);
      return;
    }
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  }
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(fig);
  still.addEventListener("change", run);
  apply(still.matches ? rest() : pose(0), 0);
}

const fig = document.querySelector('[data-figure="join"]');
if (fig) mount(fig);
