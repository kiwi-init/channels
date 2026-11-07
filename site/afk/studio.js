const FRAME = "/afk/frame";
const DEFAULT = "/afk/scene";
const READY_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024;
const CLASSIC = new Set(["", "text/javascript", "application/javascript"]);

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const sky = $("sky");
const status = $("status");
const time = $("time");
const timeOut = $("time-out");
const needs = $("needs");
const still = $("still");
const describe = $("describe");
const copyPrompt = $("copy-prompt");
const promptCode = $("prompt");
const paste = $("paste");
const notes = $("notes");
const download = $("download");
const gallery = $("gallery");
const base = $("base");

let frame = $("scene");
let html = null;
let words = "";
let picked = null;
let turns = 0;
let pinned = null;
let started = 0;
let waiting = 0;
let ready = false;
let blobUrl = null;

still.checked = matchMedia("(prefers-reduced-motion: reduce)").matches;

const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const clockAt = () => {
  if (pinned === null) return Date.now();
  const d = new Date();
  d.setHours(0, pinned, 0, 0);
  return d.getTime();
};

const send = (message) => frame.contentWindow?.postMessage({ kiwi: "afk", ...message }, "*");

const sendState = () => send({ type: "state", at: clockAt(), needs: needs.checked ? 1 : 0, still: still.checked });

function play(next, said) {
  html = next;
  words = said;
  ready = false;
  clearTimeout(waiting);
  stage.dataset.state = "starting";
  sky.hidden = true;
  status.textContent = "Starting…";
  const fresh = document.createElement("iframe");
  fresh.title = frame.title;
  fresh.setAttribute("sandbox", "allow-scripts");
  fresh.src = FRAME;
  fresh.addEventListener("load", () => {
    if (fresh !== frame) return;
    clearTimeout(waiting);
    started = performance.now();
    send({ type: "scene", html });
    sendState();
    waiting = setTimeout(() => {
      if (ready) return;
      stage.dataset.state = "plain";
      sky.hidden = false;
      status.textContent = `No ready message after ${READY_MS / 1000} s, so Channels would show a plain sky. The scene has to call parent.postMessage({ kiwi: "afk", type: "ready" }, "*") once it draws.`;
    }, READY_MS);
  });
  frame.replaceWith(fresh);
  frame = fresh;
  const box = stage.getBoundingClientRect();
  if (box.top < 0 || box.bottom > innerHeight) stage.scrollIntoView({ block: "nearest", behavior: still.checked ? "auto" : "smooth" });
}

addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow || e.data?.kiwi !== "afk" || e.data.type !== "ready" || ready) return;
  ready = true;
  clearTimeout(waiting);
  stage.dataset.state = "ready";
  status.textContent = `${words} Ready in ${((performance.now() - started) / 1000).toFixed(1)} s.`;
  sendState();
});

const picks = () => [...gallery.querySelectorAll(".pick")];

const said = (pick) => (pick.dataset.src === DEFAULT ? `${pick.dataset.name}, the scene Channels ships.` : `${pick.dataset.name}.`);

async function pick(button) {
  for (const b of picks()) b.setAttribute("aria-checked", String(b === button));
  const mine = { name: button.dataset.name, src: button.dataset.src, remix: button.dataset.remix !== "no", html: null };
  picked = mine;
  const turn = ++turns;
  showBase();
  showPrompt();
  try {
    const res = await fetch(mine.src);
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    mine.html = text;
    if (picked === mine) showPrompt();
    if (turn !== turns) return;
    setDownload(mine.src === DEFAULT ? null : text);
    play(text, said(button));
  } catch {
    // A scene the site didn't build or ship can't play; the gallery and a pasted scene still work.
    if (turn === turns) status.textContent = `${mine.name} isn't here. Pick another, or paste one below.`;
  }
}

const showBase = () => {
  if (!picked) return;
  base.textContent = picked.remix
    ? `Your agent starts from ${picked.name}.`
    : `${picked.name} is built from the app's own code, so your agent starts from a blank page. Pick another scene to start from it.`;
};

const RULES = `How it has to work:
- One self-contained HTML file. CSS in <style>, code in one classic <script>: no type="module", no src, no imports.
- It runs in a sandbox with no network: no CDNs, web fonts, fetch or remote images. Draw with canvas, WebGL, SVG or CSS. Images only as data: URLs.
- Fill the whole window and follow resizes. Keep it calm: slow movement, no words, no sound, nothing to click.
- Once the first frame is on screen, say so: parent.postMessage({ kiwi: "afk", type: "ready" }, "*")
- Listen for the app's state: addEventListener("message", (e) => …), where e.data is { kiwi: "afk", type: "state", at, needs, still }.
  - at: the time to show, in milliseconds since 1970. Run the scene's clock from it, so day and night follow it.
  - needs: how many things are waiting for me. Above 0, show it gently (a warm light, a lantern), never an alarm.
  - still: true means I asked for less motion. Draw one still frame and stop animating until it's false.
- Stop drawing while document.hidden. Keep the file under 8 MB.`;

const CRAFT = `How to make it beautiful (this is a wallpaper people will stare at, so it has to be gorgeous):
- Depth: at least three layers (far, middle, near), each moving at its own slow speed. Haze and soften the far one, let the near one go out of focus, and keep the subject sharp.
- Light: one clear light source whose colour follows the hour (dawn pink, noon white, golden-hour orange, dusk violet, night blue). Blend between them smoothly as at moves, light everything from it, add soft glows and bokeh on lights, and never use hard black.
- Colour: pick 4 to 6 colours that belong together for each time of day and stay within them. Avoid pure white, pure black and saturated primaries.
- Atmosphere: fog, haze, dust, rain or snow in the air, in front of and behind the subject. Add a faint film grain and a soft vignette so gradients don't band.
- Texture: no flat fills or bare geometric shapes. Build surfaces, clouds, water and glass from layered noise (fbm), and give lights a falloff.
- Motion: nothing moves in straight lines at a fixed speed. Use slow noise and easing so things sway, drift and breathe, and vary the periods so no loop is visible.
- Focus: one focal point with fine detail; the edges can stay simple.
- Cipher glyphs: Channels is end-to-end encrypted, so let the picture hint that what you see is really ciphertext. Every 8 to 20 seconds, at varied gaps, a short run of 6 to 20 base64 glyphs (A-Z a-z 0-9 + / =, in ui-monospace, Menlo or monospace, drawn into a canvas or glyph texture) surfaces in the scene's own material (drops, flakes, ripples, pollen, light on water), scrambles for a second or two and dissolves back. Keep it faint and lit like the scene: never a readable word, never Matrix rain. With still on, at most one faint frozen trace.
- Craft: draw at devicePixelRatio (2 at most) at 30 to 60 fps, light enough for a laptop on battery. Prefer one full-screen WebGL shader, or a few canvas layers, over thousands of DOM nodes, and fall back to canvas 2D if WebGL isn't there.`;

const LOOK =
  "If you can open a browser or take screenshots, look at it at noon, at dusk and at midnight, full screen, and fix whatever looks cheap before you reply. If you can't, picture those three frames and make each one a still worth keeping.";

const promptText = () => {
  const want = describe.value.trim() || "(say what you'd like to see)";
  const intro = "Make me an AFK scene for Channels: the full-window picture the app shows while I'm away from the keyboard.";
  if (picked?.remix && picked.html)
    return `${intro}

What I'd like: ${want}

Start from the finished scene at the end of this message, "${picked.name}". It already works and looks good, so edit it rather than starting over. Keep how it's made: the ready message, the state listener, still, document.hidden, resizing, the devicePixelRatio cap, the WebGL path and its canvas 2D fallback, the layered depth, the light that follows the hour, the noise-built textures, the grain, the vignette and the cipher glyphs that sneak in. Change what the picture shows.

${RULES}

${CRAFT}

${LOOK}

Reply with only the file, scene.html.

The scene to start from:

\`\`\`html
${picked.html}
\`\`\``;
  return `${intro}

The scene I'd like: ${want}

${RULES}

${CRAFT}

${LOOK}

Reply with only the file, scene.html.`;
};

const showPrompt = () => {
  const text = promptText();
  promptCode.textContent =
    text.length > 6000
      ? `${text.slice(0, text.indexOf("The scene to start from:"))}The scene to start from:\n\n(${picked.name}, ${Math.round(picked.html.length / 1024)} KB, comes with the copied prompt)`
      : text;
};

copyPrompt.addEventListener("click", async () => {
  showPrompt();
  try {
    await navigator.clipboard.writeText(promptText());
    copyPrompt.textContent = "Copied";
  } catch {
    // The clipboard can be refused (an insecure page, a denied permission): open the prompt so it can be selected.
    promptCode.closest("details").open = true;
    copyPrompt.textContent = "Copy it below";
  }
  setTimeout(() => (copyPrompt.textContent = "Copy prompt"), 1600);
});

describe.addEventListener("input", showPrompt);

const unfence = (text) => {
  const m = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i.exec(text);
  return m ? { text: m[1], fenced: true } : { text, fenced: false };
};

function check(text) {
  const out = [];
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) out.push({ bad: true, say: `It's ${(bytes / 1048576).toFixed(1)} MB; Channels takes up to 8 MB.` });
  const doc = new DOMParser().parseFromString(text, "text/html");
  const scripts = [...doc.querySelectorAll("script")];
  const classic = scripts.filter((s) => !s.src && CLASSIC.has((s.getAttribute("type") ?? "").trim().toLowerCase()));
  if (scripts.some((s) => s.src)) out.push({ bad: true, say: "A script with src is dropped: the scene can't load files. Ask for the code inline." });
  if (scripts.some((s) => (s.getAttribute("type") ?? "").trim().toLowerCase() === "module")) out.push({ bad: true, say: 'A type="module" script is dropped: ask for one classic script.' });
  if (classic.length === 0) out.push({ bad: true, say: "There's no inline script, so nothing would run." });
  const remote = /\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>)]*/i.exec(
    classic.map((s) => s.textContent).join("\n") + [...doc.querySelectorAll("style, link")].map((s) => s.outerHTML).join("\n"),
  );
  if (remote) out.push({ bad: false, say: `It points at ${remote[0].slice(0, 60)}, which the sandbox blocks. Fine if it's only a namespace, like SVG's.` });
  return out;
}

const showNotes = (list) => {
  notes.replaceChildren(
    ...list.map((n) => {
      const li = document.createElement("li");
      li.textContent = n.say;
      if (n.bad) li.className = "bad";
      return li;
    }),
  );
};

const setDownload = (text) => {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = text === null ? null : URL.createObjectURL(new Blob([text], { type: "text/html" }));
  download.href = blobUrl ?? DEFAULT;
};

let typing = 0;

function take(raw) {
  clearTimeout(typing);
  if (!raw.trim()) {
    showNotes([]);
    const current = picks().find((b) => b.getAttribute("aria-checked") === "true") ?? picks()[0];
    if (current) void pick(current);
    return;
  }
  turns++;
  const { text, fenced } = unfence(raw);
  const list = check(text);
  if (fenced) list.unshift({ bad: false, say: "Took off the ``` fence around it." });
  showNotes(list);
  if (list.some((n) => n.bad && n.say.includes("MB"))) {
    status.textContent = "Too big to play.";
    return;
  }
  setDownload(text);
  play(text, "Your scene.");
}

paste.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => take(paste.value), 400);
});

paste.addEventListener("dragover", (e) => {
  e.preventDefault();
  paste.classList.add("is-over");
});

paste.addEventListener("dragleave", () => paste.classList.remove("is-over"));

paste.addEventListener("drop", async (e) => {
  e.preventDefault();
  paste.classList.remove("is-over");
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  paste.value = await file.text();
  take(paste.value);
});

time.value = String(minutesNow());
time.addEventListener("input", () => {
  pinned = Number(time.value);
  timeOut.textContent = hhmm(pinned);
  sendState();
});

$("now").addEventListener("click", () => {
  pinned = null;
  time.value = String(minutesNow());
  timeOut.textContent = "now";
  sendState();
});

needs.addEventListener("change", sendState);
still.addEventListener("change", sendState);

$("full").addEventListener("click", () => {
  void stage.requestFullscreen?.();
});

gallery.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest(".pick") : null;
  if (!button || button.getAttribute("aria-checked") === "true") return;
  paste.value = "";
  showNotes([]);
  void pick(button);
});

gallery.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const all = picks();
  const at = all.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  const next = all[(at + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
  next.focus();
  next.click();
});

showPrompt();
if (picks()[0]) void pick(picks()[0]);
