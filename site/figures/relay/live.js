import * as k from "../../anatomy/iso-kit.js";
import * as M from "./model.js";

const figure = document.querySelector('[data-figure="relay"]');
if (figure) start(figure);

function writer() {
  const memory = new WeakMap();
  return function set(element, name, value) {
    if (!element) return;
    let seen = memory.get(element);
    if (!seen) {
      seen = {};
      memory.set(element, seen);
    }
    if (seen[name] === value) return;
    seen[name] = value;
    if (name === "text") element.textContent = value;
    else if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
}

function start(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const set = writer();
  const names = Object.keys(M.LAYOUT);
  const feeds = Object.fromEntries(names.map((name) => [name, [...svg.querySelectorAll(`[data-feed="${name}"] [data-row]`)]]));
  const composes = names.filter((name) => M.LAYOUT[name].compose).map((name) => ({ name, text: svg.querySelector(`[data-compose="${name}"]`), caret: svg.querySelector(`[data-caret="${name}"]`) }));
  const packets = M.CABLES.map((name) => {
    const element = svg.querySelector(`[data-packet="${name}"]`);
    return { name, element, shackle: element?.querySelector("[data-shackle]") };
  });
  const led = svg.querySelector("[data-led]");

  function render(t) {
    for (const name of names) {
      const rows = M.feedState(name, t);
      feeds[name].forEach((element, index) => {
        const row = rows[index];
        set(element, "text", row ? row.text : "");
        if (!row) return;
        set(element, "y", row.y.toFixed(2));
        set(element, "data-tone", row.tone);
        set(element, "opacity", row.opacity < 1 ? row.opacity.toFixed(2) : null);
      });
    }
    for (const { name, text, caret } of composes) {
      const state = M.composeState(name, t);
      const { x, y, em } = M.LAYOUT[name].compose;
      set(text, "text", state.text);
      const caretX = x + state.text.length * em * 0.64 + 0.6;
      set(caret, "d", `M${caretX.toFixed(1)} ${y - em * 0.78}V${y + 0.8}`);
      set(caret, "opacity", state.caret ? null : "0");
    }
    for (const { name, element, shackle } of packets) {
      const state = M.packetState(name, t);
      set(element, "opacity", state.opacity.toFixed(2));
      if (state.opacity <= 0) continue;
      set(element, "transform", k.translateAlong(M.P, M.packetAt(name, state.s)));
      set(shackle, "transform", state.open > 0 ? k.translateAlong(M.P, [0, 0, M.PACKET.lock.lift * state.open]) : null);
    }
    set(led, "data-tone", M.relayState(t).held > 0.5 ? "lit" : "lo");
  }

  let clock = M.STILL;
  let wait = 1.2;
  let last = 0;
  let frame = 0;
  let visible = false;

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    if (wait > 0) wait -= dt;
    else clock += dt;
    render(clock);
    frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
  }

  function run() {
    if (frame || !visible || still.matches) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function hold() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clock = M.STILL;
    wait = 1.2;
    render(clock);
  }

  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(figure);
  still.addEventListener("change", () => (still.matches ? hold() : run()));
  if (still.matches) hold();
}
