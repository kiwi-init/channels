const FRAME = "/afk/frame";
const DEFAULT = "/afk/scene";
const READY_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024;
const CLASSIC = new Set(["", "text/javascript", "application/javascript"]);
const DEFAULT_WORDS = "The default scene, the one Channels ships.";

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

let frame = $("scene");
let html = null;
let words = DEFAULT_WORDS;
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
}

addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow || e.data?.kiwi !== "afk" || e.data.type !== "ready" || ready) return;
  ready = true;
  clearTimeout(waiting);
  stage.dataset.state = "ready";
  status.textContent = `${words} Ready in ${((performance.now() - started) / 1000).toFixed(1)} s.`;
  sendState();
});

async function playDefault() {
  try {
    const res = await fetch(DEFAULT);
    if (!res.ok) throw new Error(String(res.status));
    play(await res.text(), DEFAULT_WORDS);
  } catch {
    // The default scene is built by scripts/docs-site.ts; without it the preview can still play a pasted one.
    status.textContent = "The default scene isn't here. Paste one below to try it.";
  }
}

const promptText = () => {
  const want = describe.value.trim() || "(say what you'd like to see)";
  return `Make me an AFK scene for Channels: the full-window picture the app shows while I'm away from the keyboard.

The scene I'd like: ${want}

How it has to work:
- One self-contained HTML file. CSS in <style>, code in one classic <script>: no type="module", no src, no imports.
- It runs in a sandbox with no network: no CDNs, web fonts, fetch or remote images. Draw with canvas, WebGL, SVG or CSS. Images only as data: URLs.
- Fill the whole window and follow resizes. Keep it calm: slow movement, no text, no sound, nothing to click.
- Once the first frame is on screen, say so: parent.postMessage({ kiwi: "afk", type: "ready" }, "*")
- Listen for the app's state: addEventListener("message", (e) => …), where e.data is { kiwi: "afk", type: "state", at, needs, still }.
  - at: the time to show, in milliseconds since 1970. Run the scene's clock from it, so day and night follow it.
  - needs: how many things are waiting for me. Above 0, show it gently (a warm light, a lantern), never an alarm.
  - still: true means I asked for less motion. Draw one still frame and stop animating until it's false.
- Stop drawing while document.hidden. Keep the file under 8 MB.

Reply with only the file, scene.html.`;
};

const showPrompt = () => {
  promptCode.textContent = promptText();
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
    setDownload(null);
    void playDefault();
    return;
  }
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

showPrompt();
void playDefault();
