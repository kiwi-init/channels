import { translateAlong } from "../../anatomy/iso-kit.js";
import { OUT_LINES, P, REST, outLine, poseAt, stageOffset } from "./model.js";

const fixed = (value) => String(Math.round(value * 1000) / 1000);

function writer() {
  const seen = new WeakMap();
  return (node, name, value) => {
    if (!node) return;
    const cache = seen.get(node) ?? {};
    if (cache[name] === value) return;
    cache[name] = value;
    seen.set(node, cache);
    if (name === "text") node.textContent = value;
    else node.setAttribute(name, value);
  };
}

function partsOf(svg) {
  const all = (name) => [...svg.querySelectorAll(`[data-part="${name}"]`)];
  const byIndex = (name) => all(name).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
  const screens = byIndex("screen").map((node) => ({
    task: node.querySelector('[data-part="task"]'),
    check: node.querySelector('[data-part="check"]'),
    out: [...node.querySelectorAll('[data-part="out"]')],
  }));
  return {
    stamp: all("stamp")[0],
    marker: all("marker")[0],
    tickets: byIndex("ticket"),
    prints: { ink: byIndex("print-ink"), lit: byIndex("print-lit") },
    ticks: { ink: byIndex("tick-ink"), lit: byIndex("tick-lit") },
    screens,
  };
}

function drawPose(parts, pose, write) {
  write(parts.stamp, "transform", translateAlong(P, pose.stamp));
  write(parts.marker, "transform", translateAlong(P, stageOffset(pose.stage)));
  pose.tickets.forEach((state, index) => {
    write(parts.tickets[index], "transform", translateAlong(P, [0, state.y, state.z]));
    write(parts.tickets[index], "opacity", fixed(state.on));
  });
  for (const [name, list] of [
    ["prints", pose.prints],
    ["ticks", pose.ticks],
  ]) {
    list.forEach((state, index) => {
      write(parts[name].ink[index], "opacity", fixed(state.on));
      write(parts[name].lit[index], "opacity", fixed(state.on * state.lit));
    });
  }
  pose.screens.forEach((state, index) => {
    const screen = parts.screens[index];
    if (!screen) return;
    write(screen.task, "text", state.task ? `› ${state.task}` : "›");
    write(screen.check, "opacity", state.done ? "1" : "0");
    screen.out.forEach((node, line) => write(node, "d", outLine(OUT_LINES[line], line, state)));
  });
}

function animate(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const parts = partsOf(svg);
  const write = writer();
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let clock = REST;
  let last = 0;
  let frame = 0;
  let visible = false;

  const tick = (now) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    drawPose(parts, poseAt(clock), write);
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  };
  const run = () => {
    if (frame || !visible || still.matches) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  const rest = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clock = REST;
    drawPose(parts, poseAt(REST), write);
  };

  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(figure);
  still.addEventListener("change", () => (still.matches ? rest() : run()));
  drawPose(parts, poseAt(REST), write);
}

const figure = document.querySelector('[data-figure="spec"]');
if (figure) animate(figure);
