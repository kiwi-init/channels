import * as k from "../../anatomy/iso-kit.js";
import { P, REST_T, drawerBody, poseAt } from "./model.js";

const figure = document.querySelector('[data-figure="selfhost"]');
if (figure) start(figure);

function start(root) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const type = root.querySelector('[data-part="type"]');
  const beads = Object.fromEntries([...root.querySelectorAll("[data-bead]")].map((node) => [node.dataset.bead, node]));
  const drawers = [...root.querySelectorAll("[data-drawer]")]
    .sort((a, b) => Number(a.dataset.drawer) - Number(b.dataset.drawer))
    .map((node) => ({
      node,
      body: node.querySelector('[data-part="body"]'),
      card: node.querySelector('[data-part="card"]'),
      front: node.querySelector('[data-part="front"]'),
      glow: node.querySelector('[data-part="glow"]'),
      labels: [...node.querySelectorAll("[data-label]")],
      label: "",
      out: -1,
    }));
  if (!type || Object.keys(beads).length !== 3 || drawers.some((drawer) => !drawer.body || !drawer.card || !drawer.front || !drawer.glow)) return;
  let clock = REST_T;
  let frame = 0;
  let last = 0;
  let visible = false;

  function draw(pose) {
    type.setAttribute("width", (pose.typed * 128).toFixed(2));
    for (const [leg, node] of Object.entries(beads)) {
      const on = pose.bead?.leg === leg;
      node.style.display = on ? "inline" : "none";
      if (!on) continue;
      const [x, y] = k.iso(pose.bead.point, P);
      const dot = node.firstElementChild;
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y.toFixed(1));
    }
    pose.drawers.forEach((state, i) => {
      const drawer = drawers[i];
      drawer.node.setAttribute("opacity", state.shown.toFixed(3));
      drawer.node.style.display = state.shown <= 0.001 ? "none" : "inline";
      drawer.front.setAttribute("transform", k.translateAlong(P, [0, state.out, 0]));
      drawer.glow.setAttribute("opacity", state.lit.toFixed(3));
      drawer.card.setAttribute("transform", k.translateAlong(P, [0, state.out - 10, state.drop * 24]));
      drawer.card.setAttribute("opacity", state.card.toFixed(3));
      if (state.label !== drawer.label) {
        for (const label of drawer.labels) label.textContent = state.label;
        drawer.label = state.label;
      }
      const out = Math.round(state.out * 10) / 10;
      if (out !== drawer.out) {
        drawer.body.innerHTML = drawerBody(i, out);
        drawer.out = out;
      }
    });
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    draw(poseAt(clock));
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }

  const run = () => {
    if (!frame && visible && !still.matches) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };

  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      run();
    },
    { rootMargin: "120px 0px" },
  ).observe(root);
  still.addEventListener("change", run);
}
