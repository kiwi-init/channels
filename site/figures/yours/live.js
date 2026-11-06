import * as k from "../../anatomy/iso-kit.js";
import { P, CARD, CARDS, PILE_ORDER, pileAt, slotAt, cardPaths, cardFace, areasOf, AREA, STEPS, TOUR, BUTTON, CURSOR_REST, BOX_FLOOR, DIVIDER, CLIP } from "./model.js";

const clamp = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (x) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const within = (t, a, b) => t >= a && t < b;

const HIGH = BOX_FLOOR + DIVIDER.h - CLIP.below + CLIP.h + CARD.h / 2 + 9;
const DROP = 0.72;
const PRESS_AT = [BUTTON.u + BUTTON.w / 2 - 1, BUTTON.v + BUTTON.h / 2 - 1];

const filedAt = (i) => STEPS[i].fly[1];
const backAt = (i) => TOUR.back[CARDS.length - 1 - i];

function flight(i, p) {
  const a = pileAt(PILE_ORDER[i]);
  const b = slotAt(i);
  const across = easeInOut((p - 0.28) / (DROP - 0.28));
  const z = p < 0.3 ? lerp(a[2], HIGH, easeOut(p / 0.3)) : p < DROP ? HIGH : lerp(HIGH, b[2], Math.pow((p - DROP) / (1 - DROP), 2));
  return { o: [lerp(a[0], b[0], across), lerp(a[1], b[1], across), z], theta: (Math.PI / 2) * smooth(0.1, 0.42, p), inBox: p >= DROP };
}

function cardAt(i, t) {
  const [a, b] = STEPS[i].fly;
  const back = backAt(i);
  if (t < a) return { ...flight(i, 0), lit: false };
  if (t < b) return { ...flight(i, (t - a) / (b - a)), lit: true };
  if (t < back) return { ...flight(i, 1), lit: false };
  if (t < back + TOUR.backFor) return { ...flight(i, 1 - (t - back) / TOUR.backFor), lit: true };
  return { ...flight(i, 0), lit: false };
}

function swapAt(t) {
  const on = filedAt(1);
  const off = backAt(1) + 0.1;
  return smooth(on, on + 0.6, t) * (1 - smooth(off, off + 0.6, t));
}

function cursorAt(t) {
  const there = easeInOut((t - TOUR.cursor[0]) / (TOUR.cursor[1] - TOUR.cursor[0]));
  const home = easeInOut((t - TOUR.press - 0.9) / 1.1);
  const lerp2 = (p, q, s) => [lerp(p[0], q[0], s), lerp(p[1], q[1], s)];
  return lerp2(lerp2(CURSOR_REST, PRESS_AT, there), CURSOR_REST, home);
}

function pose(t) {
  const filed = CARDS.map((_, i) => t >= filedAt(i) - 0.02 && t < backAt(i) + 0.1);
  return {
    cards: CARDS.map((_, i) => cardAt(i, t)),
    themed: filed[0],
    screenLit: within(t, filedAt(0), filedAt(0) + TOUR.litFor),
    swap: swapAt(t),
    keyLit: within(t, filedAt(1), filedAt(1) + TOUR.litFor),
    mirror: filed[2],
    sideLit: within(t, filedAt(2), filedAt(2) + TOUR.litFor),
    panel: filed[3] ? (t < TOUR.press + 0.25 ? "ask" : "on") : "none",
    panelLit: within(t, filedAt(3), TOUR.hold),
    buttonLit: within(t, TOUR.press - 0.1, TOUR.press + 0.25),
    cursor: cursorAt(t),
  };
}

function rest() {
  return {
    cards: CARDS.map((_, i) => ({ ...flight(i, 1), lit: false })),
    themed: true,
    screenLit: true,
    swap: 1,
    keyLit: false,
    mirror: true,
    sideLit: false,
    panel: "on",
    panelLit: false,
    buttonLit: false,
    cursor: CURSOR_REST,
  };
}

function mount(fig) {
  const svg = fig.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const get = (sel) => svg.querySelector(sel);
  const pile = get('[data-part="pile"]');
  const slots = CARDS.map((_, i) => get(`[data-slot="${i}"]`));
  const cards = CARDS.map((_, i) => {
    const el = get(`[data-card="${i}"]`);
    return { el, bits: Object.fromEntries([...el.querySelectorAll("[data-c]")].map((b) => [b.dataset.c, b])), last: "" };
  });
  const screen = get('[data-part="screen"]');
  const areas = Object.fromEntries(["rail", "side", "chat", "panel"].map((name) => [name, get(`[data-area="${name}"]`)]));
  const chatRule = get('[data-part="chat-rule"]');
  const composer = get('[data-part="composer"]');
  const sideFrame = get('[data-part="side-frame"]');
  const panelFrame = get('[data-part="panel-frame"]');
  const ask = get('[data-part="ask"]');
  const on = get('[data-part="on"]');
  const button = get('[data-part="button"]');
  const cursor = get('[data-part="cursor"]');
  const keyOld = get('[data-part="key-old"]');
  const keyNew = get('[data-part="key-new"]');
  const keyNewSolid = keyNew?.querySelector(".iso-solid");
  const up = k.axisVector(P, [0, 0, 1]);
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
  const lift = (el, h) => write(el, "transform", h > 0.001 ? `translate(${(up[0] * h).toFixed(2)} ${(up[1] * h).toFixed(2)})` : null);
  const layout = { ...areasOf(true, true) };

  function placeCard(i, state) {
    const card = cards[i];
    const parent = state.inBox ? slots[i] : pile;
    if (card.el.parentNode !== parent) parent.appendChild(card.el);
    const signature = `${state.o.map((n) => n.toFixed(2)).join(",")}|${state.theta.toFixed(4)}`;
    if (signature !== card.last) {
      card.last = signature;
      const paths = cardPaths(state.o, state.theta);
      write(card.bits.fill, "d", paths.fill);
      paths.shades.forEach((d, s) => write(card.bits[`s${s}`], "d", d));
      write(card.bits.top, "d", paths.top);
      write(card.bits.crease, "d", paths.crease);
      write(card.bits.outline, "d", paths.outline);
      write(card.bits.face, "transform", cardFace(state.o, state.theta));
    }
    flag(card.el, "data-lit", state.lit);
  }

  function placeAreas(s, dt) {
    const target = areasOf(s.mirror, s.panel !== "none");
    const rate = dt === null ? 1 : 1 - Math.exp(-dt / 0.13);
    let moving = false;
    const across = s.panel === "none" && Math.abs(target.panel - layout.panel) > AREA.panel + 1;
    for (const key of Object.keys(target)) {
      const next = key === "panel" && across ? target.panel : layout[key] + (target[key] - layout[key]) * rate;
      layout[key] = Math.abs(target[key] - next) < 0.02 ? target[key] : next;
      if (layout[key] !== target[key]) moving = true;
    }
    for (const name of ["rail", "side", "chat", "panel"]) write(areas[name], "transform", `translate(${layout[name].toFixed(2)} 0)`);
    write(chatRule, "width", layout.chatW.toFixed(2));
    write(composer, "width", (layout.chatW - 8).toFixed(2));
    return moving;
  }

  function apply(s, dt) {
    const order = CARDS.map((_, i) => i).sort((a, b) => PILE_ORDER[a] - PILE_ORDER[b]);
    for (const i of order) placeCard(i, s.cards[i]);
    flag(screen, "data-themed", s.themed);
    flag(screen, "data-lit", s.screenLit);
    lift(keyOld, 9 * smooth(0, 0.5, s.swap));
    fade(keyOld, 1 - smooth(0.2, 0.5, s.swap));
    lift(keyNew, 9 * (1 - smooth(0.5, 1, s.swap)));
    fade(keyNew, smooth(0.5, 0.7, s.swap));
    flag(keyNewSolid, "data-lit", s.keyLit);
    flag(sideFrame, "data-lit", s.sideLit);
    flag(panelFrame, "data-lit", s.panelLit);
    write(ask, "display", s.panel === "ask" ? null : "none");
    write(on, "display", s.panel === "on" ? null : "none");
    flag(button, "data-lit", s.buttonLit);
    write(cursor, "transform", `translate(${s.cursor[0].toFixed(2)} ${s.cursor[1].toFixed(2)})`);
    return placeAreas(s, dt);
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
      apply(rest(), null);
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
  apply(still.matches ? rest() : pose(0), null);
}

const fig = document.querySelector('[data-figure="yours"]');
if (fig) mount(fig);
