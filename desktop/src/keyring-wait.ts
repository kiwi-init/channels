export const KEYRING_GRACE_MS = 2_000;

export function openedWithin(opening: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([opening.then(() => true), late]).finally(() => clearTimeout(timer));
}

const STYLESHEET = /<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/gi;

export interface WaitingNote {
  title: string;
  detail: string;
  hint: string;
}

export function waitingNote(platform: NodeJS.Platform): WaitingNote {
  if (platform === "darwin")
    return {
      title: "Waiting for your keychain",
      detail: "Channels keeps its keys in your keychain. Answer the keychain's prompt, and Channels opens.",
      hint: "No prompt? It may be behind this window.",
    };
  return {
    title: "Waiting for your keyring",
    detail: "Channels keeps its keys in your keyring (GNOME Keyring or KDE Wallet). Unlock it in the prompt your desktop shows, and Channels opens.",
    hint: "No prompt? It may be behind this window.",
  };
}

const escapeText = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function waitingPage(index: string, platform: NodeJS.Platform): string {
  const note = waitingNote(platform);
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
body { display: grid; place-items: center; background: var(--canvas, Canvas); color: var(--ink, CanvasText); font-family: var(--font-sans, system-ui, sans-serif); -webkit-user-select: none; user-select: none; cursor: default; }
main { max-width: 360px; padding: 24px; text-align: center; }
h1 { margin: 0 0 8px; font-size: 16px; line-height: 21px; font-weight: 600; }
p { margin: 0; font-size: 15px; line-height: 21px; color: var(--ink-2, CanvasText); }
p + p { margin-top: 12px; font-size: 12px; line-height: 16px; color: var(--ink-3, GrayText); }
</style>
</head>
<body>
<main role="status"><h1>${escapeText(note.title)}</h1><p>${escapeText(note.detail)}</p><p>${escapeText(note.hint)}</p></main>
</body>
</html>
`;
}
