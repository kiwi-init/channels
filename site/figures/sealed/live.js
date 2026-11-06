import * as k from "../../anatomy/iso-kit.js";
import { P, REST_T, cipherAt, poseAt, rodSvg, rowsAt } from "./model.js";

const figure = document.querySelector('[data-figure="sealed"]');
if (figure) start(figure);

function start(root) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const q = (selector) => root.querySelector(selector);
  const parts = {
    good: q('[data-env="good"]'),
    forged: q('[data-env="forged"]'),
    old: q('[data-env="old-c"]'),
    belt: q('[data-slot="belt"]'),
    bin: q('[data-slot="bin"]'),
    pan: q('[data-part="pan"]'),
    needle: q('[data-part="needle"]'),
    stampLow: q('[data-part="stamp-low"]'),
    stampHigh: q('[data-part="stamp-high"]'),
    kicker: q('[data-part="kicker"]'),
    rod: q('[data-part="rod"]'),
    type: q('[data-part="type"]'),
    said: q('[data-part="said"]'),
    rows: q('[data-part="rows"]'),
    cipher: [...root.querySelectorAll("[data-cipher]")],
    lines: [...root.querySelectorAll('[data-part="rows"] [data-row]')].map((row) => row.querySelectorAll("text")[1]),
  };
  if (Object.values(parts).some((part) => !part)) return;
  const pivot = parts.needle.getAttribute("transform").match(/rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/);
  const centre = `${pivot[2]} ${pivot[3]}`;
  const needle = { at: Number(pivot[1]), rate: 0 };
  const shown = { phrase: "", rows: "", cipher: "", rod: -1, slot: "" };
  let clock = REST_T;
  let frame = 0;
  let last = 0;
  let visible = false;

  const envelopeTo = (node, state) => {
    node.setAttribute("transform", k.translateAlong(P, state.offset));
    node.querySelector('[data-part="glow"]').setAttribute("opacity", state.glow.toFixed(3));
    node.querySelector('[data-part="postmark"]').setAttribute("opacity", state.postmark.toFixed(3));
  };

  const springNeedle = (target, dt) => {
    const steps = Math.max(1, Math.round(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      needle.rate += (90 * (target - needle.at) - 11 * needle.rate) * h;
      needle.at += needle.rate * h;
    }
  };

  function draw(pose, dt) {
    envelopeTo(parts.good, pose.good);
    envelopeTo(parts.forged, pose.forged);
    const slot = pose.forged.inBin ? "bin" : "belt";
    if (slot !== shown.slot) {
      parts[slot].appendChild(parts.forged);
      shown.slot = slot;
    }
    parts.old.style.display = pose.oldShown ? "inline" : "none";
    parts.old.querySelector('[data-part="glow"]').setAttribute("opacity", pose.oldGlow.toFixed(3));
    parts.pan.setAttribute("transform", k.translateAlong(P, [0, 0, -pose.pan]));
    springNeedle(pose.needle, dt);
    parts.needle.setAttribute("transform", `rotate(${needle.at.toFixed(2)} ${centre})`);
    const press = k.translateAlong(P, [0, 0, -pose.stamp]);
    parts.stampLow.setAttribute("transform", press);
    parts.stampHigh.setAttribute("transform", press);
    parts.kicker.setAttribute("transform", k.translateAlong(P, [0, pose.kick, 0]));
    const rod = Math.round(pose.kick * 20) / 20;
    if (rod !== shown.rod) {
      parts.rod.innerHTML = rodSvg(rod);
      shown.rod = rod;
    }
    parts.type.setAttribute("width", (pose.typed * 95).toFixed(2));
    if (pose.phrase !== shown.phrase) {
      parts.said.textContent = pose.phrase;
      shown.phrase = pose.phrase;
    }
    const rows = rowsAt(pose.delivered);
    if (rows.join() !== shown.rows) {
      rows.forEach((phrase, i) => (parts.lines[i].textContent = phrase));
      shown.rows = rows.join();
    }
    parts.rows.setAttribute("transform", pose.scroll > 0.001 ? `translate(0 ${(pose.scroll * 9).toFixed(2)})` : "");
    const cipher = cipherAt(pose.checks);
    if (cipher.join() !== shown.cipher) {
      cipher.forEach((row, i) => (parts.cipher[i].textContent = row));
      shown.cipher = cipher.join();
    }
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    draw(poseAt(clock), dt);
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
