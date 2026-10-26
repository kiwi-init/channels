export const KEYRING_GRACE_MS = 2_000;

export const ASK_AGAIN_URL = "views://internal/kiwi-ask-again";

export type KeyringState = "waiting" | "cancelled" | "locked";

export function openedWithin(opening: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([opening.then(() => true), late]).finally(() => clearTimeout(timer));
}

const STYLESHEET = /<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/gi;

interface WaitingNote {
  title: string;
  detail: string;
  hint: string;
  askAgain: boolean;
}

export function keyringNote(platform: NodeJS.Platform, state: KeyringState): WaitingNote {
  if (platform === "darwin")
    return {
      title: "Waiting for your keychain",
      detail: "Channels keeps its keys in your keychain. Answer the keychain's prompt, and Channels opens.",
      hint: "No prompt? It may be behind this window.",
      askAgain: false,
    };
  if (state === "cancelled")
    return {
      title: "You cancelled the keyring prompt",
      detail: "Channels keeps its keys only in your keyring (GNOME Keyring or KDE Wallet), so it can't open without it.",
      hint: "Ask again when you're ready to unlock it.",
      askAgain: true,
    };
  if (state === "locked")
    return {
      title: "Your keyring stayed locked",
      detail: "Your keys are in your keyring (GNOME Keyring or KDE Wallet), and Channels can't read them until it's unlocked.",
      hint: "Ask again to unlock it.",
      askAgain: true,
    };
  return {
    title: "Waiting for your keyring",
    detail: "Channels keeps its keys in your keyring (GNOME Keyring or KDE Wallet). Unlock it in the prompt your desktop shows, and Channels opens.",
    hint: "No prompt? It may be behind this window.",
    askAgain: true,
  };
}

const escapeText = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function keyringPage(index: string, platform: NodeJS.Platform, state: KeyringState): string {
  const note = keyringNote(platform, state);
  const sheets = (index.match(STYLESHEET) ?? []).join("");
  const ask = note.askAgain ? `<a class="ask" href="${ASK_AGAIN_URL}">Ask again</a>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="light dark" />
<title>Channels</title>
${sheets}
<style>
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; background: var(--canvas, Canvas); color: var(--ink, CanvasText); font-family: var(--font-sans, system-ui, sans-serif); -webkit-user-select: none; user-select: none; cursor: default; }
main { max-width: 360px; padding: 24px; text-align: center; }
h1 { margin: 0 0 8px; font-size: 16px; line-height: 21px; font-weight: 600; }
p { margin: 0; font-size: 15px; line-height: 21px; color: var(--ink-2, CanvasText); }
p.hint { margin-top: 12px; font-size: 12px; line-height: 16px; color: var(--ink-3, GrayText); }
.ask { display: inline-block; margin-top: 16px; padding: 0 12px; height: var(--control, 26px); line-height: var(--control, 26px); border-radius: var(--radius-row, 8px); background: var(--accent, AccentColor); color: var(--accent-ink, AccentColorText); font-size: 13px; font-weight: 500; text-decoration: none; cursor: default; }
</style>
</head>
<body>
<main role="status"><h1>${escapeText(note.title)}</h1><p>${escapeText(note.detail)}</p><p class="hint">${escapeText(note.hint)}</p>${ask}</main>
</body>
</html>
`;
}
