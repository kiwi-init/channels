import { AGENTS, flagSolids, LETTER, LINES, solidDs, STILL } from "./model.js";

const ORDER = [1, 0, 2];
const CYCLE = 8.6;
const FALL = 1.6;
const SHOWN = [2.2, 3.3, 3.7, 3.85, 4, 5.3];
const UP = [FALL, 4.6];
const AWAKE = [2, 7.2];
const TYPE = 0.045;
const START = 2.6 + CYCLE * ORDER.indexOf(STILL);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const within = (c, [a, b]) => c >= a && c < b;

function phaseAt(clock) {
  const n = Math.floor(clock / CYCLE);
  return { active: ORDER[n % ORDER.length], c: clock - n * CYCLE };
}

function targetsOf(index, { active, c }) {
  const on = index === active;
  return {
    flag: on && within(c, UP) ? 1 : 0,
    glow: on && within(c, AWAKE) ? 1 : 0,
    lines: SHOWN.map((at) => (on && c >= at && c < AWAKE[1] ? 1 : 0)),
    typed: on && AGENTS[index].typed ? Math.max(0, Math.floor((c - SHOWN[LINES.wake]) / TYPE)) : Infinity,
    letter: on && c < FALL + 0.2 ? c : -1,
  };
}

function refsOf(svg, index) {
  const pane = svg.querySelector(`[data-pane="${index}"]`);
  const flag = svg.querySelector(`[data-flag="${index}"]`);
  const lines = [];
  pane.querySelectorAll("[data-line]").forEach((node) => {
    const at = Number(node.dataset.line);
    if (Number.isInteger(at)) lines[at] = node;
  });
  return {
    glow: pane.querySelector("[data-glow]"),
    lines,
    solids: [...flag.querySelectorAll(".iso-solid")].map((group) => [...group.children]),
    lit: flag.querySelector("[data-flag-lit]"),
    letter: svg.querySelector(`[data-letter="${index}"]`),
  };
}

function stateOf(index) {
  const awake = index === STILL;
  return {
    flag: { x: awake ? 1 : 0, v: 0 },
    glow: awake ? 1 : 0,
    lines: SHOWN.map((_, at) => (awake && at === LINES.wake ? 1 : 0)),
    typed: Infinity,
    drawn: { flag: -1, glow: -1, lines: [], typed: -1, letter: -2 },
  };
}

function stepFlag(flag, target, dt) {
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    const stiffness = target ? 150 : 70;
    const damping = target ? 9 : 11;
    flag.v += (stiffness * (target - flag.x) - damping * flag.v) * h;
    flag.x += flag.v * h;
    if (flag.x < 0) {
      flag.x = 0;
      flag.v = -flag.v * 0.25;
    }
    left -= h;
  }
  if (Math.abs(flag.x - target) < 5e-4 && Math.abs(flag.v) < 5e-4) {
    flag.x = target;
    flag.v = 0;
  }
}

const follow = (value, target, dt, seconds) => {
  const next = value + (target - value) * (1 - Math.exp(-dt / seconds));
  return Math.abs(next - target) < 2e-3 ? target : next;
};

function drawFlag(refs, state) {
  const x = state.flag.x;
  if (Math.abs(x - state.drawn.flag) < 2e-4) return;
  state.drawn.flag = x;
  const [arm, plate] = flagSolids(refs.index, x).map(solidDs);
  refs.solids.forEach((paths, at) => {
    const ds = at % 2 ? plate : arm;
    paths.forEach((node, j) => node.setAttribute("d", ds[j]));
  });
  const lit = smooth(0.3, 0.85, x);
  refs.lit.setAttribute("opacity", lit.toFixed(3));
}

function drawPane(refs, state, agent) {
  if (Math.abs(state.glow - state.drawn.glow) > 1e-3) {
    state.drawn.glow = state.glow;
    refs.glow.setAttribute("opacity", state.glow.toFixed(3));
  }
  state.lines.forEach((value, at) => {
    if (Math.abs(value - (state.drawn.lines[at] ?? -1)) < 1e-3) return;
    state.drawn.lines[at] = value;
    refs.lines[at]?.setAttribute("opacity", value.toFixed(3));
  });
  const typed = Math.min(agent.wake.length, state.typed);
  if (typed !== state.drawn.typed) {
    state.drawn.typed = typed;
    refs.lines[LINES.wake].textContent = agent.wake.slice(0, typed);
  }
}

function drawLetter(refs, state, c) {
  if (c === state.drawn.letter) return;
  state.drawn.letter = c;
  if (c < 0) {
    refs.letter.setAttribute("opacity", "0");
    return;
  }
  const p = Math.min(1, c / FALL);
  const drop = (LETTER.top - LETTER.rest) * smooth(0, 1, p);
  const sway = 1.6 * Math.sin(p * Math.PI * 2.5) * (1 - p);
  refs.letter.setAttribute("transform", `translate(${sway.toFixed(2)} ${drop.toFixed(2)})`);
  refs.letter.setAttribute("opacity", smooth(0, 0.3, c).toFixed(3));
}

function start(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const refs = AGENTS.map((_, index) => ({ ...refsOf(svg, index), index }));
  const states = AGENTS.map((_, index) => stateOf(index));
  let clock = START;
  let frame = 0;
  let last = 0;
  let visible = false;

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    const phase = phaseAt(clock);
    AGENTS.forEach((agent, index) => {
      const target = targetsOf(index, phase);
      const state = states[index];
      stepFlag(state.flag, target.flag, dt);
      state.glow = follow(state.glow, target.glow, dt, 0.32);
      state.lines = state.lines.map((value, at) => follow(value, target.lines[at], dt, at === LINES.wake && agent.typed ? 0.02 : 0.07));
      state.typed = target.typed;
      drawFlag(refs[index], state);
      drawPane(refs[index], state, agent);
      drawLetter(refs[index], state, target.letter);
    });
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }

  const run = () => {
    if (frame || !visible || still.matches) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(figure);
  still.addEventListener("change", run);
}

const figure = document.querySelector('[data-figure="wake"]');
if (figure) start(figure);
