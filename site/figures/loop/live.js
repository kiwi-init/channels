import { EXTRAS, flightPose, landAngle, lengthOf, needlePaths, poseMatrix, printerPose, scheduleOf, screenAt, slipLength, smooth01, SPIKE, spikePose, STACK, stackZ, STILL, TASKS } from "./model.js";

const taskOf = (n) => TASKS[n % TASKS.length];
const fullOf = (n) => lengthOf(taskOf(n), taskOf(n).work.length + 1);
const zOf = (n) => stackZ(STACK.length + n);
const REST = 1.6;
const FADE = 0.9;

function phaseOf(n, c) {
  const s = scheduleOf(taskOf(n));
  if (c < s.tear) return { at: "printer", length: slipLength(taskOf(n), c), s };
  if (c < s.land) return { at: "flight", t: (c - s.tear) / (s.land - s.tear), s };
  return { at: "spike", s };
}

function poseOf(n, phase) {
  if (phase.at === "printer") return { pose: printerPose(phase.length), z: Infinity };
  if (phase.at === "flight") {
    const pose = flightPose(fullOf(n), phase.t, zOf(n), landAngle(n));
    return { pose, z: phase.t > 0.62 && pose.centre[2] < SPIKE.tip - 1 ? pose.centre[2] : Infinity };
  }
  return { pose: spikePose(fullOf(n), zOf(n), landAngle(n)), z: zOf(n) };
}

function rowsOf(n, c) {
  const task = taskOf(n);
  const s = scheduleOf(task);
  if (c < s.tear + 0.5) return screenAt(task, c);
  const next = taskOf(n + 1);
  const text = c < s.land + 0.3 ? "kiwi loop · session ended" : `kiwi loop › ${next.log} · fresh session`;
  return [{ text, tone: "lo", on: 1 }];
}

function needleDs(z0, z1, tip) {
  const paths = needlePaths(z0, z1, tip);
  return paths ? [paths.fill, ...paths.shades, paths.top, paths.outline] : ["", "", "", "", "", "", ""];
}

function start(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const slips = Array.from({ length: EXTRAS }, (_, n) => {
    const group = svg.querySelector(`[data-slip="${n}"]`);
    return { group, pose: group.querySelector("[data-pose]"), lit: group.querySelector("[data-lit]"), needle: svg.querySelector(`[data-needle="x${n}"]`), drawn: {} };
  });
  const topNeedle = svg.querySelector(`[data-needle="s${STACK.length - 1}"]`);
  const rows = [...svg.querySelectorAll("[data-row]")].map((node) => ({ node, text: node.textContent, tone: node.dataset.tone, at: node.getAttribute("opacity") === "0" ? 0 : 1 }));
  const needles = new Map();
  let n = 0;
  let c = STILL.c;
  let frame = 0;
  let last = 0;
  let visible = false;
  let gone = -1;

  function setNeedle(node, key, z0, z1) {
    const id = `${z0.toFixed(2)}:${z1.toFixed(2)}`;
    if (needles.get(key) === id) return;
    needles.set(key, id);
    const ds = z1 > z0 ? needleDs(z0, z1, true) : needleDs(0, 0, true);
    [...node.children].forEach((path, j) => path.setAttribute("d", ds[j]));
  }

  function drawSlip(index, phase) {
    const slip = slips[index];
    const { pose, z } = poseOf(index, phase);
    if (gone <= 0) slip.group.setAttribute("opacity", "1");
    slip.pose.setAttribute("transform", poseMatrix(pose));
    const clipped = phase.at === "printer";
    if (clipped !== slip.drawn.clipped) {
      slip.drawn.clipped = clipped;
      if (clipped) slip.group.setAttribute("clip-path", "url(#loop-slot)");
      else slip.group.removeAttribute("clip-path");
    }
    const lit = phase.at === "printer" ? 1 : phase.at === "flight" ? 1 - smooth01(phase.t / 0.7) : 0;
    slip.lit.setAttribute("opacity", lit.toFixed(3));
    return z;
  }

  function drawGone(fade) {
    if (fade === gone) return;
    gone = fade;
    if (!fade) return;
    const value = (1 - fade).toFixed(3);
    slips.forEach((slip) => {
      slip.group.setAttribute("opacity", value);
      slip.needle.setAttribute("opacity", value);
    });
  }

  function drawNeedles(zs, fade) {
    const on = zs.map((z, i) => ({ z, i })).filter(({ z }) => Number.isFinite(z));
    const first = on.length && !fade ? on[0].z : SPIKE.tip;
    setNeedle(topNeedle, "top", stackZ(STACK.length - 1), first);
    slips.forEach((slip, i) => {
      const at = on.findIndex((entry) => entry.i === i);
      if (at < 0) return setNeedle(slip.needle, i, 0, 0);
      const next = at + 1 < on.length ? on[at + 1].z : SPIKE.tip;
      setNeedle(slip.needle, i, on[at].z, next);
    });
  }

  function drawRows(dt, calm) {
    const want = rowsOf(n, c);
    rows.forEach((row, i) => {
      const line = want[i] ?? { text: row.text, tone: row.tone, on: 0 };
      if (line.on && (line.text !== row.text || line.tone !== row.tone)) {
        row.text = line.text;
        row.tone = line.tone;
        row.node.textContent = line.text;
        row.node.dataset.tone = line.tone;
      }
      const target = line.on ? 1 : 0;
      const next = calm ? target : row.at + (target - row.at) * (1 - Math.exp(-dt / 0.06));
      const value = Math.abs(next - target) < 0.01 ? target : next;
      if (value !== row.at) {
        row.at = value;
        row.node.setAttribute("opacity", value.toFixed(3));
      }
    });
  }

  function reset(at) {
    n = 0;
    c = at;
    gone = -1;
    slips.forEach((slip, i) => {
      if (i || at !== STILL.c) slip.group.setAttribute("opacity", "0");
      slip.needle.setAttribute("opacity", "1");
      slip.drawn = {};
    });
    needles.clear();
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    c += dt;
    if (c >= scheduleOf(taskOf(n)).end && n < EXTRAS - 1) {
      c -= scheduleOf(taskOf(n)).end;
      n += 1;
    }
    const fade = n === EXTRAS - 1 ? smooth01((c - scheduleOf(taskOf(n)).end - REST) / FADE) : 0;
    if (fade >= 1) reset(0);
    const zs = slips.map((_, i) => (i < n ? zOf(i) : i === n ? drawSlip(i, phaseOf(i, c)) : Infinity));
    drawGone(fade >= 1 ? 0 : fade);
    drawNeedles(zs, fade >= 1 ? 0 : fade);
    drawRows(dt, false);
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
      else if (n > 2) reset(STILL.c);
    },
    { rootMargin: "120px 0px" },
  ).observe(figure);
  still.addEventListener("change", run);
}

const figure = document.querySelector('[data-figure="loop"]');
if (figure) start(figure);
