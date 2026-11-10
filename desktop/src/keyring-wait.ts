import { againLink, escapeText, notePage } from "./note-page.ts";

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

export function keyringPage(index: string, platform: NodeJS.Platform, state: KeyringState): string {
  const note = keyringNote(platform, state);
  const ask = note.askAgain ? againLink(ASK_AGAIN_URL, "Ask again") : "";
  return notePage(index, "status", `<h1>${escapeText(note.title)}</h1>\n<p>${escapeText(note.detail)}</p>\n<p class="hint">${escapeText(note.hint)}</p>\n${ask}`);
}
