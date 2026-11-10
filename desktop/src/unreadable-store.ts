import { ASK_AGAIN_URL } from "./keyring-wait.ts";
import { againLink, escapeText, notePage } from "./note-page.ts";

export interface Unreadable {
  why: string;
  advice: string;
  file: string;
  log: string;
}

const sentence = (s: string): string => {
  const text = s.trim().replace(/[.;:,\s]+$/, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

export function unreadablePage(index: string, u: Unreadable): string {
  return notePage(
    index,
    "alert",
    `<h1>Channels can't read your keys</h1>
<p>Your channels and keys are still on this computer. Channels changes nothing there until it can read them.</p>
<p class="next">${escapeText(sentence(u.advice))}</p>
<dl>
<div><dt>Why</dt><dd>${escapeText(u.why)}</dd></div>
<div><dt>Where they are</dt><dd>${escapeText(u.file)}</dd></div>
<div><dt>Details</dt><dd>${escapeText(u.log)}</dd></div>
</dl>
${againLink(ASK_AGAIN_URL, "Try again")}`,
  );
}
