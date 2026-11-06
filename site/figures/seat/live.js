import { translateAlong } from "../../anatomy/iso-kit.js";
import { P, REST, SLOPE, poseAt, skipAhead, stillAfter } from "./model.js";

const fixed = (value) => String(Math.round(value * 1000) / 1000);

function writer() {
  const seen = new WeakMap();
  return (node, name, value) => {
    if (!node) return;
    const cache = seen.get(node) ?? {};
    if (cache[name] === value) return;
    cache[name] = value;
    seen.set(node, cache);
    node.setAttribute(name, value);
  };
}

function drawPose(slips, pose, write) {
  pose.slips.forEach((state, index) => {
    write(
      slips[index],
      "transform",
      translateAlong(
        P,
        SLOPE.up.map((value) => value * state.v),
      ),
    );
    write(slips[index], "opacity", fixed(state.on));
  });
}

function animate(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const slips = [...svg.querySelectorAll('[data-part="slip"]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
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
    drawPose(slips, poseAt(clock), write);
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
    drawPose(slips, poseAt(REST), write);
  };
  const swap = () => {
    clock = still.matches ? stillAfter(clock) : skipAhead(clock);
    drawPose(slips, poseAt(clock), write);
  };

  figure.tabIndex = 0;
  figure.setAttribute("role", "button");
  figure.setAttribute("aria-label", "Swap the nickname slip on the nameplate; the engraved handle stays");
  figure.style.cursor = "pointer";
  figure.addEventListener("click", swap);
  figure.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    swap();
  });

  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(figure);
  still.addEventListener("change", () => (still.matches ? rest() : run()));
  drawPose(slips, poseAt(REST), write);
}

const figure = document.querySelector('[data-figure="seat"]');
if (figure) animate(figure);
