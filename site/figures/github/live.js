import * as k from "../../anatomy/iso-kit.js";
import * as G from "../../anatomy/lathe.js";
import { GH_ROUTE, LAP_ROUTE, OPEN, P, SLIP, SLOT, at, cipherOf, lidPaths, screenMatrix, slipPaths, slipRest, slipText } from "./model.js";

const LOOP = 16;
const HIDDEN = 13;
const WEBHOOKS = [0.6, 2.9, 5.2];
const POSTS = [10.8, 11.8, 12.8];
const STEPS = {
  open: [7.8, 9.0],
  wake: [8.6, 9.1],
  lift: [9.3, 9.9],
  fetch: [9.9, 10.6],
  sleep: [14.0, 14.4],
  close: [14.4, 15.4],
};
const STILL = 9.42;

const clamp = (value) => Math.min(1, Math.max(0, value));
const ease = (value) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const span = (t, from, to) => ease((t - from) / (to - from));
const fade = (t, inFrom, inTo, outFrom, outTo) => Math.min(span(t, inFrom, inTo), 1 - span(t, outFrom, outTo));
const fall = (t, from, to) => clamp((t - from) / (to - from)) ** 2;

function polyline(points) {
  const flat = points.map((point) => at(point));
  const lengths = [0];
  for (let i = 1; i < flat.length; i++) lengths.push(lengths[i - 1] + Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]));
  return { flat, lengths, total: lengths[lengths.length - 1] };
}

function slice(line, from, to) {
  const pointAt = (s) => {
    let i = 1;
    while (i < line.lengths.length - 1 && line.lengths[i] < s) i++;
    const a = line.flat[i - 1];
    const b = line.flat[i];
    const t = (s - line.lengths[i - 1]) / (line.lengths[i] - line.lengths[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out = [pointAt(from)];
  line.lengths.forEach((s, i) => s > from && s < to && out.push(line.flat[i]));
  out.push(pointAt(to));
  return k.pathOf(out);
}

function solidRefs(group) {
  return {
    group,
    fill: group.querySelector(".iso-fill"),
    shades: [...group.querySelectorAll(".iso-shade")],
    top: group.querySelector(".iso-top"),
    crease: group.querySelector(".iso-crease"),
    edge: group.querySelector(".iso-edge"),
  };
}

function applySolid(refs, paths) {
  refs.fill.setAttribute("d", paths.fill);
  refs.top.setAttribute("d", paths.top);
  refs.crease.setAttribute("d", paths.crease || "");
  refs.edge.setAttribute("d", paths.outline);
  refs.shades.forEach((path, i) => path.setAttribute("d", paths.shades[i] || ""));
}

function start(root) {
  const svg = root.querySelector("svg");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const find = (selector) => svg.querySelector(selector);
  const slips = [0, 1, 2].map((i) => {
    const group = find(`[data-slip="${i}"]`);
    return { group, solid: solidRefs(group.querySelector(".iso-solid")), face: group.querySelector("[data-slip-face]"), rest: slipRest(i), key: "" };
  });
  const lid = solidRefs(find('[data-part="lid"]'));
  const screen = find('[data-part="screen"]');
  const app = find('[data-part="app"]');
  const rows = [0, 1, 2].map((i) => find(`[data-row="${i}"]`));
  const packet = find('[data-part="packet"]');
  const cipher = [0, 1, 2].map((i) => find(`[data-cipher="${i}"]`));
  const lines = {
    gh: { line: polyline(G.resample(GH_ROUTE, 2)), el: find('[data-part="pulse-gh"]') },
    lap: { line: polyline(G.resample(LAP_ROUTE, 2)), el: find('[data-part="pulse-lap"]') },
  };
  const lapPoints = G.resample(LAP_ROUTE, 1);
  const lapLength = G.pathLength(lapPoints);
  const shown = new Map();
  const attrs = new Map();
  let angle = -1;
  let frame = 0;
  let last = 0;
  let clock = 0;
  let loops = 0;
  let posted = -1;
  let visible = false;

  const set = (element, name, value) => {
    let seen = attrs.get(element);
    if (!seen) attrs.set(element, (seen = {}));
    if (seen[name] === value) return;
    seen[name] = value;
    element.setAttribute(name, value);
  };
  const opacity = (element, value) => {
    const v = Math.round(value * 100) / 100;
    if (shown.get(element) === v) return;
    shown.set(element, v);
    element.style.opacity = String(v);
  };
  const lit = (element, on) => {
    if (element.hasAttribute("data-lit") !== on) element.toggleAttribute("data-lit", on);
  };

  function runPulse({ line, el }, run, reverse, skip) {
    if (run > 0 && run < 1) {
      const length = 26;
      const usable = line.total - skip;
      const travel = (usable + length) * run;
      const head = reverse ? line.total - travel : skip + travel;
      const from = reverse ? Math.max(skip, head) : Math.max(skip, head - length);
      const to = reverse ? Math.min(line.total, head + length) : Math.min(line.total, head);
      set(el, "d", to > from ? slice(line, from, to) : "");
    } else set(el, "d", "");
  }

  function placeSlip(slip, y0, y1, z, face, alpha, on) {
    const key = `${y0.toFixed(2)} ${y1.toFixed(2)} ${z.toFixed(2)}`;
    if (key !== slip.key) {
      slip.key = key;
      applySolid(slip.solid, slipPaths(slip.rest.x, y0, y1, z));
      set(slip.face, "transform", slipText(slip.rest.x, y0, z));
    }
    opacity(slip.group, alpha);
    opacity(slip.face, face);
    lit(slip.solid.group, on);
  }

  function slipAt(slip, i, t) {
    const s = WEBHOOKS[i];
    const out = [s + 0.8, s + 1.5];
    const drop = [s + 1.5, s + 2.1];
    const { rest } = slip;
    const slotZ = SLOT.z - SLIP.t / 2;
    if (t < out[0]) return placeSlip(slip, SLOT.y, SLOT.y + 0.01, slotZ, 0, 0, false);
    if (t < out[1]) {
      const e = span(t, ...out);
      return placeSlip(slip, SLOT.y, SLOT.y + SLIP.d * e, slotZ, 0, 1, true);
    }
    const lifting = span(t, ...STEPS.lift);
    if (t < drop[1]) {
      const forward = span(t, drop[0], drop[0] + 0.32);
      const down = fall(t, drop[0] + 0.12, drop[1]);
      const y = SLOT.y + (rest.y - SLOT.y) * forward;
      return placeSlip(slip, y, y + SLIP.d, slotZ + (rest.z - slotZ) * down, span(t, drop[0], drop[1]), 1, true);
    }
    const gone = 1 - span(t, STEPS.lift[0] + 0.3, STEPS.lift[1]);
    const moving = t > STEPS.lift[0] && t < STEPS.lift[1];
    return placeSlip(slip, rest.y, rest.y + SLIP.d, rest.z + lifting * 10, gone, gone, moving);
  }

  function setLid(next) {
    if (Math.abs(next - angle) < 1e-5) return;
    angle = next;
    applySolid(lid, lidPaths(angle));
    set(screen, "transform", screenMatrix(angle));
    opacity(screen, clamp((angle - 0.75) / 0.6));
  }

  function setCipher(count) {
    if (count === posted) return;
    posted = count;
    cipher.forEach((el, i) => {
      el.textContent = cipherOf(count + i);
    });
  }

  function place(t) {
    WEBHOOKS.forEach((s, i) => slipAt(slips[i], i, t));
    const ghRun = WEBHOOKS.map((s) => clamp((t - s) / 0.8)).find((run) => run > 0 && run < 1) ?? 0;
    runPulse(lines.gh, ghRun, false, 0);

    setLid(OPEN * (span(t, ...STEPS.open) - span(t, ...STEPS.close)));
    opacity(app, fade(t, ...STEPS.wake, ...STEPS.sleep));
    rows.forEach((row, i) => opacity(row, span(t, POSTS[i], POSTS[i] + 0.3)));

    runPulse(lines.lap, clamp((t - STEPS.fetch[0]) / (STEPS.fetch[1] - STEPS.fetch[0])), true, HIDDEN);

    const sending = POSTS.map((p) => clamp((t - p - 0.15) / 0.7)).find((run) => run > 0 && run < 1) ?? 0;
    if (sending > 0) {
      const s = HIDDEN + 6 + (lapLength - HIDDEN - 8) * ease(sending);
      const point = G.pointAlong(lapPoints, s);
      set(packet, "transform", k.translateAlong(P, [point[0], point[1], point[2] - 1.1]));
    }
    opacity(packet, sending > 0 ? Math.min(clamp(sending / 0.12), clamp((1 - sending) / 0.1)) : 0);

    const arrived = POSTS.filter((p) => t >= p + 0.85).length;
    setCipher(loops * 3 + arrived);
    const fresh = POSTS.some((p) => t >= p + 0.85 && t < p + 1.15);
    cipher[2].toggleAttribute("data-on", fresh);
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    if (clock >= LOOP) {
      clock -= LOOP;
      loops += 1;
    }
    place(clock);
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
    clock = STILL;
    place(clock);
  }

  still.addEventListener("change", () => (still.matches ? rest() : run()));
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(root);
  clock = 0.2;
  place(still.matches ? STILL : clock);
  if (still.matches) rest();
}

const root = document.querySelector('[data-figure="github"]');
if (root) start(root);
