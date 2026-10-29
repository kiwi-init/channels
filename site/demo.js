const root = document.getElementById("demo");
if (root) start(root);

function start(root) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const feed = root.querySelector("[data-feed]");
  const board = root.querySelector("[data-board]");
  const side = root.querySelector("[data-side]");
  const chips = root.querySelector("[data-chips]");
  const form = root.querySelector("[data-composer]");
  const input = form.querySelector("input");
  const lenses = [...root.querySelectorAll("[data-lens]")];
  const tabs = [...root.querySelectorAll("[data-tab]")];
  const taskCount = root.querySelector("[data-task-count]");

  const LOGOS = {
    claude: {
      d: "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z",
      rule: "evenodd",
    },
    codex: {
      d: "M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z",
      rule: "nonzero",
    },
  };
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const MEMBERS = {
    you: { name: "you", role: "owner", human: true, key: hex(4) },
    maya: { name: "maya", role: "", human: true, key: hex(4) },
    atlas: { name: "atlas", role: "lead", harness: "claude", runs: "Claude Code", key: hex(4) },
    win: { name: "win", role: "", harness: "codex", runs: "Codex", key: hex(4) },
  };

  let relayView = false;
  let tab = "chat";
  let nextTask = 12;
  let nextPr = 43;
  const messages = [];
  const tasks = new Map();
  const typing = new Set();
  const shown = new Set();
  const NS = "http://www.w3.org/2000/svg";

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === undefined || value === null) continue;
      if (key === "text") el.textContent = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  }
  function logo(harness) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", LOGOS[harness].d);
    path.setAttribute("fill-rule", LOGOS[harness].rule);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }
  function avatar(id) {
    const m = MEMBERS[id];
    if (m.human) return h("span", { class: "av av-human", "aria-hidden": "true", text: m.name[0].toUpperCase() });
    return h("span", { class: "av av-agent", title: m.runs }, logo(m.harness));
  }
  const clock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let key = null;
  const keyReady = crypto?.subtle ? crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]).then((k) => (key = k)) : Promise.resolve(null);
  const b64url = (bytes) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  async function seal(text) {
    await keyReady;
    const plain = new TextEncoder().encode(text);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = key
      ? new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("#general") }, key, plain))
      : crypto.getRandomValues(new Uint8Array(plain.length + 16));
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv);
    all.set(ct, iv.length);
    return { text: b64url(all), bytes: all.length };
  }

  async function post(from, text, extra = {}) {
    const message = { id: messages.length, from, text, at: new Date(), sealed: await seal(text), ...extra };
    messages.push(message);
    renderFeed(true);
    renderSide();
    return message;
  }

  const STATUS = { planned: "planned", working: "working", review: "in review", done: "done", waiting: "needs you" };
  function taskChip(id) {
    const t = tasks.get(id);
    if (!t) return null;
    return h(
      "button",
      { class: `chip-task is-${t.status}`, type: "button", "data-open-task": id },
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", { class: "tid", text: t.id }),
      h("span", { class: "ttl", text: t.title }),
      h("span", { class: "tmeta", text: ` · ${t.owner} · ${STATUS[t.status]}` }),
      t.pr ? h("span", { class: "tpr", text: ` · PR #${t.pr}` }) : null,
    );
  }

  function permBlock(m) {
    const p = m.perm;
    const state = p.answer
      ? h("p", { class: `perm-state is-${p.answer}`, text: `${p.answer === "allow" ? "Allowed" : "Denied"} by you · ${clock(p.at)}` })
      : h("p", { class: "perm-state is-waiting", text: "Waiting on you" });
    const buttons = p.answer
      ? null
      : h(
          "div",
          { class: "perm-actions" },
          h("button", { type: "button", class: "btn-allow", "data-perm": m.id, "data-answer": "allow", text: "Allow" }),
          h("button", { type: "button", class: "btn-deny", "data-perm": m.id, "data-answer": "deny", text: "Deny" }),
        );
    return h("div", { class: "perm" }, h("p", { class: "perm-title", text: p.title }), h("pre", { class: "perm-code", text: p.code }), state, buttons);
  }

  function row(m) {
    const fresh = !shown.has(m.id) && !still.matches;
    shown.add(m.id);
    const el = rowOf(m);
    if (fresh) el.classList.add("is-new");
    return el;
  }
  function rowOf(m) {
    const who = MEMBERS[m.from];
    if (relayView) {
      return h(
        "article",
        { class: "msg is-sealed" },
        h("span", { class: "av av-key", "aria-hidden": "true" }, keyGlyph()),
        h(
          "div",
          { class: "msg-body" },
          h(
            "p",
            { class: "msg-head" },
            h("span", { class: "msg-name", text: `key ${who.key.slice(0, 4)}…${who.key.slice(-2)}` }),
            h("span", { class: "msg-meta", text: `${clock(m.at)} · ${m.sealed.bytes} B` }),
          ),
          h("p", { class: "msg-text is-cipher", "data-scramble": m.id, text: m.sealed.text }),
        ),
      );
    }
    return h(
      "article",
      { class: `msg${m.from === "you" ? " is-you" : ""}` },
      avatar(m.from),
      h(
        "div",
        { class: "msg-body" },
        h(
          "p",
          { class: "msg-head" },
          h("span", { class: "msg-name", text: who.name }),
          who.role ? h("span", { class: "msg-role", text: who.role }) : null,
          !who.human ? h("span", { class: "msg-runs", text: who.runs }) : null,
          h("span", { class: "msg-meta", text: clock(m.at) }),
        ),
        h("p", { class: "msg-text", "data-scramble": m.id, text: m.text }),
        m.task ? taskChip(m.task) : null,
        m.perm ? permBlock(m) : null,
      ),
    );
  }
  function keyGlyph() {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7M3.5 7h9v7h-9z");
    body.setAttribute("fill", "none");
    body.setAttribute("stroke", "currentColor");
    body.setAttribute("stroke-width", "1.2");
    svg.append(body);
    return svg;
  }

  function renderFeed(stick = false) {
    const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const list = [];
    if (relayView) list.push(h("p", { class: "relay-note" }, keyGlyph(), h("span", { text: "The relay's copy of #general: who sent it (a key), when, and how big. Not one word." })));
    for (const m of messages) list.push(row(m));
    for (const id of typing) list.push(h("p", { class: "typing" }, h("span", { class: "typing-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), h("span", { text: `${id} is typing` })));
    feed.replaceChildren(...list);
    if (stick || near) feed.scrollTop = feed.scrollHeight;
  }

  function renderSide() {
    const item = (id, extra) => {
      const m = MEMBERS[id];
      const busy = [...tasks.values()].find((t) => t.owner === id && (t.status === "working" || t.status === "review"));
      const status = typing.has(id) ? "typing…" : busy ? `${busy.id} ${STATUS[busy.status]}` : m.human ? "online" : "idle";
      return h(
        "li",
        { class: "side-member" },
        avatar(id),
        h("span", { class: "side-name", text: m.name }),
        m.role ? h("span", { class: "side-role", text: m.role }) : null,
        h("span", { class: "side-status", text: extra ?? status }),
      );
    };
    side.replaceChildren(
      h("p", { class: "side-h", text: "Channels" }),
      h("ul", {}, h("li", { class: "side-chan is-on", text: "# general" }), h("li", { class: "side-chan", text: "# releases" })),
      h("p", { class: "side-h", text: "People" }),
      h("ul", {}, item("you"), item("maya")),
      h("p", { class: "side-h", text: "Agents" }),
      h("ul", {}, item("atlas"), item("win")),
    );
    const open = [...tasks.values()].filter((t) => t.status !== "done").length;
    taskCount.textContent = open ? String(open) : "";
  }

  function renderBoard() {
    const groups = [
      ["Needs you", (t) => t.status === "waiting"],
      ["Working", (t) => t.status === "working" || t.status === "planned"],
      ["In review", (t) => t.status === "review"],
      ["Done", (t) => t.status === "done"],
    ];
    const kids = [];
    for (const [title, test] of groups) {
      const list = [...tasks.values()].filter(test).reverse();
      if (!list.length) continue;
      kids.push(
        h(
          "section",
          { class: "board-group" },
          h("p", { class: "board-h" }, h("span", { text: title }), h("span", { class: "board-n", text: String(list.length) })),
          ...list.map((t) =>
            h(
              "div",
              { class: `board-row is-${t.status}` },
              h("span", { class: "dot", "aria-hidden": "true" }),
              h("span", { class: "board-title", text: t.title }),
              h("span", { class: "board-meta", text: `${t.id} · ${t.owner} · ${STATUS[t.status]}${t.pr ? ` · PR #${t.pr}` : ""}` }),
            ),
          ),
        ),
      );
    }
    board.replaceChildren(...kids);
  }

  function renderAll() {
    renderFeed();
    renderSide();
    if (tab === "tasks") renderBoard();
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, still.matches ? Math.min(ms, 120) : ms));
  async function say(id, text, extra = {}, think = 900) {
    typing.add(id);
    renderAll();
    await wait(think + Math.min(1800, text.length * 22));
    typing.delete(id);
    return post(id, text, extra);
  }
  function setTask(id, patch) {
    Object.assign(tasks.get(id), patch);
    renderAll();
  }

  function titleOf(text) {
    const clean = text
      .replace(/@\w+/g, "")
      .replace(/^\s*(please|pls|can you|could you|would you|hey|ok|so)[\s,]+/i, "")
      .replace(/[?.!\s]+$/, "")
      .trim();
    const t = clean.charAt(0).toUpperCase() + clean.slice(1);
    return t.length > 46 ? `${t.slice(0, 45)}…` : t || "Look into it";
  }
  const mentions = (text) => [...text.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase()).filter((n) => MEMBERS[n]);
  const busyWith = (id) => [...tasks.values()].find((t) => t.owner === id && (t.status === "working" || t.status === "planned"));

  async function runTask(text, named) {
    const owner = named.includes("atlas") ? "atlas" : named.includes("win") ? "win" : busyWith("win") ? "atlas" : "win";
    const reviewer = owner === "win" ? "atlas" : "win";
    const id = `T${nextTask++}`;
    tasks.set(id, { id, title: titleOf(text), owner, status: "planned" });
    await say("atlas", owner === "atlas" ? `I'll take this one myself: ${id}.` : `On it. ${id} goes to win.`, { task: id });
    await wait(700);
    setTask(id, { status: "working" });
    if (owner === "win") await say("win", `Starting ${id}.`);
    await wait(3600);
    const pr = nextPr++;
    setTask(id, { status: "review", pr });
    await say(owner, `Done: PR #${pr} is up. @${reviewer} can you review?`, { task: id });
    await wait(1200);
    await say(reviewer, `Reviewed #${pr}. Clean, merged.`, {}, 1400);
    setTask(id, { status: "done" });
    if (Math.random() < 0.5) await say("maya", "nice, thanks!", {}, 1600);
  }

  const RISKY = [
    [/\b(ship|release|publish|tag)\b/i, "Permission to use Bash", "git tag v1.0.0 && git push origin v1.0.0"],
    [/\b(deploy)\b/i, "Permission to use Bash", "bunx wrangler deploy"],
    [/\b(delete|drop|remove|wipe|rm)\b/i, "Irreversible step for you", "rm -rf build/ && git push --force"],
  ];
  async function runRisky(text, [, title, code]) {
    const id = `T${nextTask++}`;
    tasks.set(id, { id, title: titleOf(text), owner: "win", status: "waiting" });
    await say("atlas", `${id} for win. It can't be undone, so it waits for you.`, { task: id });
    const m = await say("win", "This needs your OK first:", { perm: { title, code, answer: null, task: id } });
    return m;
  }
  async function answerPerm(m, answer) {
    if (m.perm.answer) return;
    m.perm.answer = answer;
    m.perm.at = new Date();
    renderAll();
    const t = tasks.get(m.perm.task);
    if (answer === "allow") {
      setTask(t.id, { status: "working" });
      await say("win", "Thanks. Running it now.", {}, 600);
      await wait(2400);
      setTask(t.id, { status: "done" });
      await say("win", `Done. ${t.id} finished.`, { task: t.id });
    } else {
      setTask(t.id, { status: "done" });
      await say("win", "OK, I won't. Holding it.", {}, 600);
    }
  }

  function reply(text) {
    const lower = text.toLowerCase();
    const named = mentions(text);
    if (named.includes("maya") && named.length === 1) return say("maya", "on my phone, will look in a bit 👍", {}, 2600);
    const risky = RISKY.find(([re]) => re.test(lower));
    if (risky) return runRisky(text, risky);
    if (/\b(encrypt|relay|read this|secure|private|privacy|see this|e2e|end-to-end)\b/i.test(lower))
      return say("atlas", "No, the relay can't read a word. Flip “What the relay sees” at the top: that's its whole copy.");
    if (/^(hi|hey|hello|yo|oi|ola|olá|hiya|morning|good morning)\b/i.test(lower)) return say("atlas", "Hi! I'm atlas, the lead (Claude Code). win runs on Codex. Give us something to do.");
    if (/\b(who|what|status|working on|doing|progress|tasks?|anything)\b/i.test(lower) && /\?$/.test(text.trim())) {
      const open = [...tasks.values()].filter((t) => t.status !== "done");
      const list = open.map((t) => `${t.owner} has ${t.id} (${STATUS[t.status]})`).join(", ");
      const waiting = open.filter((t) => t.status === "waiting").length;
      return say("atlas", `${list || "Nothing open"}. ${waiting ? `${waiting} waiting on you.` : "Nothing waits on you."}`);
    }
    if (
      /^(please|pls|can you|could you|would you|let'?s|add|fix|make|build|write|create|update|refactor|test|port|rename|improve|implement|design|translate|move|clean|bump|document|change|try)\b/i.test(
        lower.replace(/@\w+\s*/g, ""),
      ) ||
      named.length
    )
      return runTask(text, named);
    if (/\?$/.test(text.trim())) return say("atlas", "Good question. Want me to open a task for it? Start with “add…” or “fix…” and it's on the board.");
    return say("atlas", ["Noted.", "Got it.", "👍 noted."][Math.floor(Math.random() * 3)]);
  }

  const SUGGEST = ["hey team", "@win add a dark mode toggle", "who's working on what?", "ship it", "can the relay read this?"];
  function renderChips() {
    const used = new Set(messages.filter((m) => m.from === "you").map((m) => m.text));
    const left = SUGGEST.filter((s) => !used.has(s)).slice(0, 3);
    chips.replaceChildren(...left.map((s) => h("button", { type: "button", class: "suggest", "data-suggest": s, text: s })));
  }

  async function send(text) {
    const clean = text.trim().slice(0, 140);
    if (!clean) return;
    await post("you", clean);
    renderChips();
    reply(clean);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    if (relayView) setRelay(false);
    if (tab !== "chat") setTab("chat");
    send(text);
  });
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const suggest = target?.closest("[data-suggest]");
    if (suggest) {
      if (relayView) setRelay(false);
      if (tab !== "chat") setTab("chat");
      send(suggest.getAttribute("data-suggest"));
      return;
    }
    const perm = target?.closest("[data-perm]");
    if (perm) {
      const m = messages[Number(perm.getAttribute("data-perm"))];
      answerPerm(m, perm.getAttribute("data-answer"));
      return;
    }
    if (target?.closest("[data-open-task]")) setTab("tasks");
  });

  function setTab(next) {
    tab = next;
    for (const b of tabs) b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    root.toggleAttribute("data-on-tasks", tab === "tasks");
    feed.hidden = tab !== "chat";
    board.hidden = tab !== "tasks";
    if (tab === "tasks") renderBoard();
    else renderFeed(true);
  }
  for (const b of tabs) b.addEventListener("click", () => setTab(b.getAttribute("data-tab")));

  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function scramble(el, from, to, ms = 650) {
    if (still.matches) return;
    const startAt = performance.now();
    const n = Math.max(from.length, to.length);
    const step = (now) => {
      const u = Math.min(1, (now - startAt) / ms);
      let out = "";
      for (let i = 0; i < n; i++) {
        const edge = i / n;
        if (u > edge + 0.25) out += to[i] ?? "";
        else if (u > edge) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        else out += from[i] ?? "";
      }
      el.textContent = out;
      if (u < 1) requestAnimationFrame(step);
      else el.textContent = to;
    };
    requestAnimationFrame(step);
  }
  function setRelay(on) {
    if (relayView === on) return;
    relayView = on;
    for (const b of lenses) b.setAttribute("aria-pressed", String((b.getAttribute("data-lens") === "relay") === on));
    root.toggleAttribute("data-relay-view", on);
    if (tab !== "chat") setTab("chat");
    renderFeed();
    for (const el of feed.querySelectorAll("[data-scramble]")) {
      const m = messages[Number(el.getAttribute("data-scramble"))];
      if (m) scramble(el, on ? m.text : m.sealed.text, on ? m.sealed.text : m.text);
    }
  }
  for (const b of lenses) b.addEventListener("click", () => setRelay(b.getAttribute("data-lens") === "relay"));

  (async () => {
    const ago = (min) => new Date(Date.now() - min * 60000);
    tasks.set("T9", { id: "T9", title: "Fold duplicate event rows", owner: "atlas", status: "done", pr: 41 });
    tasks.set("T10", { id: "T10", title: "Shrink the first-load bundle", owner: "win", status: "working" });
    tasks.set("T11", { id: "T11", title: "Polish the conversation feed", owner: "atlas", status: "planned" });
    const seed = [
      ["maya", "morning! anything blocking the release?", {}, 14],
      ["atlas", "Nothing blocking. win is on T10.", { task: "T10" }, 13],
      ["win", "Bundle is down 38 KB so far. PR in a bit.", {}, 9],
      ["maya", "great. I'm on my phone today, ping me if you need me", {}, 6],
    ];
    for (const [from, text, extra, min] of seed) {
      messages.push({ id: messages.length, from, text, at: ago(min), sealed: await seal(text), ...extra });
      shown.add(messages.length - 1);
    }
    renderAll();
    renderChips();
    feed.scrollTop = feed.scrollHeight;
  })();
}
