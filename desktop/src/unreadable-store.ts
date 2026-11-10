import { ASK_AGAIN_URL } from "./keyring-wait.ts";

export interface Unreadable {
  why: string;
  advice: string;
  file: string;
  log: string;
}

const STYLESHEET = /<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/gi;

const escapeText = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const sentence = (s: string): string => {
  const text = s.trim().replace(/[.;:,\s]+$/, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

export function unreadablePage(index: string, u: Unreadable): string {
  const sheets = (index.match(STYLESHEET) ?? []).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="light dark" />
<title>Channels</title>
${sheets}
<style>
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; background: var(--bg, Canvas); color: var(--ink, CanvasText); font: var(--t-ui, 13px) / 1.6 var(--ui, system-ui, sans-serif); cursor: default; }
.drag { position: fixed; top: 0; right: 0; left: 0; height: 40px; -webkit-app-region: drag; }
main { max-width: 400px; padding: 32px; }
h1 { margin: 0; font: 600 var(--t-body, 15px) / 1.4 var(--ui, system-ui, sans-serif); }
p { margin: 4px 0 0; color: var(--ink-2, CanvasText); }
p.next { margin-top: 12px; color: var(--ink, CanvasText); }
dl { margin: 16px 0 0; display: grid; gap: 8px; }
dt { color: var(--ink-3, GrayText); font-size: var(--t-meta, 12px); }
dd { margin: 0; color: var(--ink-2, CanvasText); font: var(--t-meta, 12px) / 1.5 var(--mono, ui-monospace, monospace); overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; cursor: text; }
.again { display: inline-flex; align-items: center; height: var(--ctl, 32px); margin-top: 20px; padding: 0 12px; border-radius: var(--r-ctl, 10px); background: var(--ink, CanvasText); color: var(--on-ink, Canvas); font: 600 var(--t-ui, 13px) var(--ui, system-ui, sans-serif); text-decoration: none; cursor: default; }
.again:hover { opacity: 0.88; }
</style>
</head>
<body>
<div class="drag"></div>
<main role="alert">
<h1>Channels can't read your keys</h1>
<p>Your channels and keys are still on this computer. Channels changes nothing there until it can read them.</p>
<p class="next">${escapeText(sentence(u.advice))}</p>
<dl>
<div><dt>Why</dt><dd>${escapeText(u.why)}</dd></div>
<div><dt>Where they are</dt><dd>${escapeText(u.file)}</dd></div>
<div><dt>Details</dt><dd>${escapeText(u.log)}</dd></div>
</dl>
<a class="again" href="${ASK_AGAIN_URL}">Try again</a>
</main>
</body>
</html>
`;
}
