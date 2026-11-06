import * as k from "../../anatomy/iso-kit.js";
import { P, DIGITS, CARD, CARD_TRAY, CARD_SLOT, CARD_TOP, STAMP_REST, REMOVE_AT, CURSOR_REST, TOUR, cardPaths, cardFace } from "./model.js";

const clamp = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (x) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const PRESS_Z = CARD_TRAY[2] + CARD.t;
const LIFT_Z = 30;
const ABOVE = [CARD_SLOT[0], CARD_SLOT[1], CARD_SLOT[2] + 26];
const keyOf = (d) => (d === 0 ? 10 : d);

function stampAt(t) {
  const [a, b] = TOUR.stamp;
  const over = [CARD_TRAY[0] - STAMP_REST[0], CARD_TRAY[1] - STAMP_REST[1]];
  const s = (t - a) / (b - a);
  if (s <= 0 || s >= 1) return [0, 0, 0];
  const up = smooth(0, 0.18, s) * (1 - smooth(0.82, 1, s));
  const across = smooth(0.14, 0.36, s) * (1 - smooth(0.62, 0.86, s));
  const press = smooth(0.38, 0.46, s) * (1 - smooth(0.54, 0.62, s));
  return [over[0] * across, over[1] * across, LIFT_Z * up - (LIFT_Z - PRESS_Z) * press];
}

function stampedAt() {
  const [a, b] = TOUR.stamp;
  return a + (b - a) * 0.46;
}

function cardAt(t) {
  if (t < TOUR.fly[0]) return { o: CARD_TRAY, theta: 0, vMin: -CARD.h / 2 };
  if (t < TOUR.fly[1]) {
    const p = easeInOut((t - TOUR.fly[0]) / (TOUR.fly[1] - TOUR.fly[0]));
    const o = lerp3(CARD_TRAY, ABOVE, p);
    o[2] += Math.sin(Math.PI * p) * 34;
    return { o, theta: (Math.PI / 2) * smooth(0.1, 0.75, p), vMin: -CARD.h / 2 };
  }
  const d = clamp((t - TOUR.drop[0]) / (TOUR.drop[1] - TOUR.drop[0]));
  const fall = d * d;
  const pull = easeInOut((t - TOUR.pull[0]) / (TOUR.pull[1] - TOUR.pull[0]));
  const z = lerp(ABOVE[2], CARD_SLOT[2], fall) + pull * 30;
  const o = [CARD_SLOT[0], CARD_SLOT[1], z];
  return { o, theta: Math.PI / 2, vMin: CARD_TOP - z };
}

function pose(t) {
  const typedAt = (i) => TOUR.type[0] + i * TOUR.type[1];
  const typed = [...DIGITS].map((_, i) => t >= typedAt(i));
  const typing = t >= TOUR.digits && t < TOUR.listed;
  const caret = typing ? typed.indexOf(false) : -1;
  const keys = [...DIGITS].map((d, i) => ({ col: keyOf(Number(d)), down: smooth(typedAt(i) - 0.04, typedAt(i), t) * (1 - smooth(typedAt(i) + 0.08, typedAt(i) + 0.16, t)) }));
  const fadeOut = 1 - smooth(TOUR.end - 0.8, TOUR.end - 0.15, t);
  const card = cardAt(t);
  const stamped = t >= stampedAt();
  const cursorTo = easeInOut((t - TOUR.cursor[0]) / (TOUR.cursor[1] - TOUR.cursor[0]));
  const cursorBack = easeInOut((t - TOUR.remove - 0.5) / 1.2);
  return {
    lines: {
      "t-login": smooth(TOUR.login, TOUR.login + 0.2, t) * fadeOut,
      "t-signed": smooth(TOUR.signed, TOUR.signed + 0.2, t) * fadeOut,
      "t-ask": smooth(TOUR.digits, TOUR.digits + 0.2, t) * fadeOut,
      "t-digits": smooth(TOUR.digits, TOUR.digits + 0.2, t) * fadeOut,
      "t-kept": smooth(TOUR.kept, TOUR.kept + 0.3, t) * (1 - smooth(TOUR.dark, TOUR.dark + 0.4, t)),
    },
    typed: typed.map((on) => (on ? fadeOut : 0)),
    typingLit: typing,
    caret,
    keys,
    row: smooth(TOUR.listed, TOUR.listed + 0.35, t) * (1 - smooth(TOUR.remove + 0.15, TOUR.remove + 0.6, t)),
    removeLit: t >= TOUR.remove - 0.05 && t < TOUR.remove + 0.5,
    led: t >= TOUR.kept && t < TOUR.dark,
    card: { ...card, alpha: smooth(0.1, 0.5, t) * (1 - smooth(TOUR.pull[0] + 0.3, TOUR.pull[1], t)) },
    cardLit: stamped && t < TOUR.kept + 1.2,
    seal: stamped ? 1 : 0,
    stamp: stampAt(t),
    cursor: [lerp(lerp(CURSOR_REST[0], REMOVE_AT[0], cursorTo), CURSOR_REST[0], cursorBack), lerp(lerp(CURSOR_REST[1], REMOVE_AT[1], cursorTo), CURSOR_REST[1], cursorBack)],
  };
}

function rest() {
  return {
    lines: { "t-login": 1, "t-signed": 1, "t-ask": 1, "t-digits": 1, "t-kept": 1 },
    typed: [1, 1, 1, 1, 1, 1],
    typingLit: false,
    caret: -1,
    keys: [],
    row: 1,
    removeLit: false,
    led: true,
    card: { o: CARD_SLOT, theta: Math.PI / 2, vMin: CARD_TOP - CARD_SLOT[2], alpha: 1 },
    cardLit: true,
    seal: 1,
    stamp: [0, 0, 0],
    cursor: CURSOR_REST,
  };
}

function mount(fig) {
  const svg = fig.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const get = (sel) => svg.querySelector(sel);
  const lines = Object.fromEntries(["t-login", "t-signed", "t-ask", "t-digits", "t-kept"].map((name) => [name, get(`[data-part="${name}"]`)]));
  const digits = [...Array(6)].map((_, i) => get(`[data-digit="${i}"]`));
  const boxes = [...Array(6)].map((_, i) => get(`[data-box="${i}"]`));
  const keyEls = new Map([...svg.querySelectorAll("[data-key]")].map((el) => [Number(el.dataset.key), el]));
  const row = get('[data-part="row-new"]');
  const remove = get('[data-part="row-new"] text:last-of-type');
  const led = get('[data-part="led"]');
  const card = get('[data-part="card"]');
  const cardBits = Object.fromEntries([...card.querySelectorAll("[data-c]")].map((el) => [el.dataset.c, el]));
  const face = get('[data-part="face"]');
  const faceClip = get('[data-part="face-clip"]');
  const seal = get('[data-part="seal"]');
  const stamp = get('[data-part="stamp"]');
  const halo = get('[data-part="stamp-halo"]');
  const cursor = get('[data-part="cursor"]');
  const down = k.axisVector(P, [0, 0, -1]);
  const home = k.iso(STAMP_REST, P);
  const cache = new Map();
  const write = (el, name, value) => {
    if (!el) return;
    const seen = cache.get(el) ?? {};
    if (seen[name] === value) return;
    seen[name] = value;
    cache.set(el, seen);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  const flag = (el, name, on) => write(el, name, on ? "" : null);
  const fade = (el, a) => write(el, "opacity", a >= 0.999 ? null : Math.max(0, a).toFixed(3));
  let lastCard = "";

  function apply(s) {
    for (const [name, el] of Object.entries(lines)) fade(el, s.lines[name]);
    digits.forEach((el, i) => {
      fade(el, s.typed[i]);
      flag(el, "data-lit", s.typingLit);
    });
    boxes.forEach((el, i) => flag(el, "data-on", i === s.caret));
    const pressed = new Map(s.keys.map(({ col, down: d }) => [col, d]));
    for (const [col, el] of keyEls) {
      const d = (pressed.get(col) ?? 0) * 0.9;
      write(el, "transform", d > 0.001 ? `translate(${(down[0] * d).toFixed(2)} ${(down[1] * d).toFixed(2)})` : null);
    }
    fade(row, s.row);
    flag(remove, "data-lit", s.removeLit);
    flag(led, "data-on", s.led);
    const { o, theta, vMin, alpha } = s.card;
    const signature = `${o.map((n) => n.toFixed(2)).join(",")}|${theta.toFixed(4)}|${vMin.toFixed(2)}`;
    if (signature !== lastCard) {
      lastCard = signature;
      const paths = cardPaths(o, theta, vMin);
      write(cardBits.fill, "d", paths.fill);
      paths.shades.forEach((d, i) => write(cardBits[`s${i}`], "d", d));
      write(cardBits.top, "d", paths.top);
      write(cardBits.crease, "d", paths.crease);
      write(cardBits.outline, "d", paths.outline);
      write(face, "transform", cardFace(o, theta));
      write(faceClip, "height", (CARD.h / 2 - Math.max(-CARD.h / 2, vMin) + 1).toFixed(2));
    }
    fade(card, alpha);
    flag(card, "data-lit", s.cardLit);
    fade(seal, s.seal);
    const [dx, dy, dz] = s.stamp;
    const p = k.iso([STAMP_REST[0] + dx, STAMP_REST[1] + dy, dz], P);
    write(stamp, "transform", dx || dy || dz ? `translate(${(p[0] - home[0]).toFixed(2)} ${(p[1] - home[1]).toFixed(2)})` : null);
    fade(halo, (1 - clamp(dz / 6)) * (1 - clamp(Math.hypot(dx, dy) / 8)));
    write(cursor, "transform", `translate(${s.cursor[0].toFixed(2)} ${s.cursor[1].toFixed(2)})`);
  }

  let frame = 0;
  let last = 0;
  let clock = 0;
  let visible = false;

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock = (clock + dt) % TOUR.end;
    apply(pose(clock));
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }
  function run() {
    if (still.matches) {
      apply(rest());
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
  apply(still.matches ? rest() : pose(0));
}

const fig = document.querySelector('[data-figure="devices"]');
if (fig) mount(fig);
