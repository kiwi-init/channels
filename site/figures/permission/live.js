import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { ARM, LAP_ROUTE, MON_ROUTE, P, TRAVEL, armPaths, at } from "./model.js";

const LOOP = 11;
const LIFT = (84 * Math.PI) / 180;
const CURSOR_REST = [96, 72];
const CURSOR_BUTTON = [66, 57];
const SOLIDS = ["boom", "tip"];

const clamp = (value) => Math.min(1, Math.max(0, value));
const ease = (value) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const span = (t, from, to) => ease((t - from) / (to - from));
const fade = (t, inFrom, inTo, outFrom, outTo) => Math.min(span(t, inFrom, inTo), 1 - span(t, outFrom, outTo));

const STEPS = {
  arrive: [0, 1.7],
  ask: [1.7, 2.1],
  cursor: [2.6, 3.5],
  press: [3.65, 4.05],
  pulse: [4.05, 4.75],
  clear: [4.75, 5.05],
  lift: [4.75, 5.6],
  pass: [5.5, 7.3],
  output: [6.9, 7.2],
  close: [7.2, 8.1],
  away: [4.4, 5.2],
  rest: [9.8, 10.4],
};

function polyline(points) {
  const flat = points.map((point) => at(point));
  const lengths = [0];
  for (let i = 1; i < flat.length; i++) lengths.push(lengths[i - 1] + Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]));
  return { flat, lengths, total: lengths[lengths.length - 1] };
}

function slice(line, from, to) {
  const out = [];
  const pointAt = (s) => {
    let i = 1;
    while (i < line.lengths.length - 1 && line.lengths[i] < s) i++;
    const a = line.flat[i - 1];
    const b = line.flat[i];
    const t = (s - line.lengths[i - 1]) / (line.lengths[i] - line.lengths[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  out.push(pointAt(from));
  line.lengths.forEach((s, i) => s > from && s < to && out.push(line.flat[i]));
  out.push(pointAt(to));
  return k.pathOf(out);
}

function start(root) {
  const svg = root.querySelector("svg");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const find = (selector) => svg.querySelector(selector);
  const box = find('[data-part="box"]');
  const slots = { a: find('[data-slot="a"]'), b: find('[data-slot="b"]') };
  const arm = Object.fromEntries(
    SOLIDS.map((key) => {
      const group = find(`[data-arm="${key}"]`);
      return [
        key,
        {
          group,
          fill: group.querySelector(".iso-fill"),
          shades: [...group.querySelectorAll(".iso-shade")],
          top: group.querySelector(".iso-top"),
          crease: group.querySelector(".iso-crease"),
          edge: group.querySelector(".iso-edge"),
        },
      ];
    }),
  );
  const bands = find('[data-arm="bands"]');
  const termAsk = find('[data-term="ask"]');
  const termDone = find('[data-term="done"]');
  const card = find('[data-app="card"]');
  const appAsk = find('[data-app="ask"]');
  const appDone = find('[data-app="done"]');
  const appElsewhere = find('[data-app="elsewhere"]');
  const yes = find('[data-part="yes"]');
  const pulseMon = find('[data-part="pulse-mon"]');
  const allow = find('[data-part="allow"]');
  const cursor = find('[data-part="cursor"]');
  const pulse = find('[data-part="pulse"]');
  const cables = {
    app: { line: polyline(G.resample(LAP_ROUTE, 2)), from: 14 * P.scale, el: pulse },
    term: { line: polyline(G.resample(MON_ROUTE, 2)), from: 2 * P.scale, el: pulseMon },
  };
  const shown = new Map();
  let slot = "a";
  let angle = -1;
  let frame = 0;
  let last = 0;
  let clock = 0;
  let visible = false;

  const opacity = (element, value) => {
    const v = Math.round(value * 100) / 100;
    if (shown.get(element) === v) return;
    shown.set(element, v);
    element.style.opacity = String(v);
  };

  function setArm(next) {
    if (Math.abs(next - angle) < 1e-5) return;
    angle = next;
    const paths = armPaths(angle);
    for (const key of SOLIDS) {
      const el = arm[key];
      const p = paths[key];
      el.fill.setAttribute("d", p.fill);
      el.top.setAttribute("d", p.top);
      el.crease.setAttribute("d", p.crease);
      el.edge.setAttribute("d", p.outline);
      el.shades.forEach((path, i) => path.setAttribute("d", p.shades[i] || ""));
    }
    bands.setAttribute("d", paths.bands);
  }

  function setLit(element, on) {
    if (element.hasAttribute("data-lit") !== on) element.toggleAttribute("data-lit", on);
  }

  function runPulse(cable, run) {
    const { line, from, el } = cable;
    if (run > 0 && run < 1) {
      const length = 22;
      const head = from + (line.total - from + length) * run;
      el.setAttribute("d", slice(line, Math.max(from, head - length), Math.min(line.total, head)));
    } else if (el.getAttribute("d")) el.setAttribute("d", "");
  }

  function place(t, source) {
    const arriving = span(t, ...STEPS.arrive);
    const passing = span(t, ...STEPS.pass);
    const x = t < STEPS.pass[0] ? TRAVEL.from + (TRAVEL.wait - TRAVEL.from) * arriving : TRAVEL.wait + (TRAVEL.into - TRAVEL.wait) * passing;
    box.setAttribute("transform", k.translateAlong(P, [x - TRAVEL.wait, 0, 0]));
    const want = x > ARM.x + ARM.t / 2 + 0.5 ? "b" : "a";
    if (want !== slot) {
      slots[want].appendChild(box);
      slot = want;
    }

    const lift = span(t, ...STEPS.lift) - span(t, ...STEPS.close);
    setArm(LIFT * lift);
    const moving = t > STEPS.lift[0] && t < STEPS.close[1];
    setLit(arm.boom.group, moving);
    setLit(arm.tip.group, moving);

    const fromApp = source === "app";
    const pressing = fade(t, STEPS.press[0], STEPS.press[0] + 0.12, STEPS.press[1] - 0.1, STEPS.press[1]);
    const pressed = fromApp ? pressing : 0;
    allow.setAttribute("transform", pressed ? `translate(0 ${(pressed * 0.9).toFixed(2)})` : "");
    allow.toggleAttribute("data-on", pressed > 0.3);
    yes.toggleAttribute("data-on", !fromApp && pressing > 0.3);

    const toButton = fromApp ? span(t, ...STEPS.cursor) : 0;
    const away = fromApp ? span(t, ...STEPS.away) : 0;
    const cx = CURSOR_REST[0] + (CURSOR_BUTTON[0] - CURSOR_REST[0]) * (toButton - away * 0.7);
    const cy = CURSOR_REST[1] + (CURSOR_BUTTON[1] - CURSOR_REST[1]) * (toButton - away * 0.7) + pressed * 0.9;
    cursor.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`);

    const run = clamp((t - STEPS.pulse[0]) / (STEPS.pulse[1] - STEPS.pulse[0]));
    runPulse(cables.app, fromApp ? run : 0);
    runPulse(cables.term, fromApp ? 0 : run);

    opacity(card, fade(t, STEPS.ask[0], STEPS.ask[1], STEPS.rest[0], STEPS.rest[1]));
    const answered = fromApp ? span(t, STEPS.press[1], STEPS.press[1] + 0.25) : span(t, STEPS.clear[0], STEPS.clear[1]);
    opacity(appAsk, 1 - answered);
    opacity(appDone, fromApp ? answered : 0);
    opacity(appElsewhere, fromApp ? 0 : answered);
    const cleared = fromApp ? STEPS.clear : [STEPS.press[1], STEPS.press[1] + 0.3];
    opacity(termAsk, fade(t, STEPS.ask[0], STEPS.ask[1], cleared[0], cleared[1]));
    opacity(termDone, fade(t, STEPS.output[0], STEPS.output[1], STEPS.rest[0], STEPS.rest[1]));
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock = (clock + dt) % (LOOP * 2);
    place(clock % LOOP, clock < LOOP ? "app" : "term");
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }

  function run() {
    if (frame || !visible || still.matches) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function rest() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clock = STEPS.press[0] + 0.2;
    place(clock, "app");
  }

  still.addEventListener("change", () => (still.matches ? rest() : run()));
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(root);
  clock = STEPS.ask[1] + 0.4;
  if (still.matches) rest();
}

const root = document.querySelector('[data-figure="permission"]');
if (root) start(root);
