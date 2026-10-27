import fs from "node:fs";
import path from "node:path";
import Electrobun, { PATHS, Utils, type BrowserWindow } from "electrobun/main";

import { AppEngine, placeFiles, readFolder, type AppEngineEvent, type UiFiles } from "../.hutch/devkit/api/sdks/main/entries/appengine.ts";
import pkg from "../package.json" with { type: "json" };
import { PAGE_TEMPLATE } from "./eb-page.ts";
import { UI_MANIFEST_URL, UI_POLL_MS, UI_PREFIX, UI_READY_MS, UI_TRUSTED_KEYS } from "./ui-channel.ts";
import { UI_CONTRACT } from "./ui-contract.ts";
import { hearUi } from "./ui-signals.ts";
import { dataDir } from "./host-eb.ts";

declare const KIWI_EB_DEV: boolean;
declare const KIWI_EB_LIVEWIRE: boolean;
declare const KIWI_EB_TEST: boolean;
declare const KIWI_UI_SEQ: number;

interface Channel {
  manifestUrl: string;
  trustedKeys: Record<string, string>;
}

const testChannel = (value: string | undefined): Channel | null => {
  const [manifestUrl, keyId, publicKey, extra] = (value ?? "").split(" ");
  return manifestUrl?.startsWith("http://127.0.0.1:") && keyId && publicKey && extra === undefined ? { manifestUrl, trustedKeys: { [keyId]: publicKey } } : null;
};

const official = (): Channel => ({ manifestUrl: UI_MANIFEST_URL, trustedKeys: { ...UI_TRUSTED_KEYS } });

function devChannelLine(): string | undefined {
  try {
    return fs.readFileSync(path.join(dataDir, "ui-dev-channel"), "utf8").trim();
  } catch {
    // No file: a dev build without a local channel shows its built-in UI.
    return process.env.KIWI_EB_UI_CHANNEL;
  }
}

const devChannel: Channel | null = KIWI_EB_DEV ? testChannel(devChannelLine()) : null;

const channel: Channel | null = KIWI_EB_TEST ? testChannel(process.env.KIWI_EB_UI_CHANNEL) : devChannel ? devChannel : KIWI_EB_LIVEWIRE ? official() : null;

export const uiFromChannel: boolean = channel !== null;

export const uiViewsRoot = (): string => path.join(Utils.paths.userData, "appengine", "views");

const INDEX = "index.html";

function builtInFiles(): UiFiles {
  const files = readFolder(path.join(PATHS.VIEWS_FOLDER, UI_PREFIX));
  files.set(INDEX, new Uint8Array(fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "..", PAGE_TEMPLATE))));
  return files;
}

function say(event: AppEngineEvent): void {
  if (event.type === "failed") console.error(`Channels UI: ${event.manifest.uiVersion} failed (${event.reason})${event.banned ? "; it won't boot again" : ""}`);
  else if (event.type === "safe-mode") console.error(`Channels UI: ${event.reason}`);
  else if (event.type === "built-in") console.log(`Channels UI: the built-in UI (${event.reason})`);
  else if (event.type === "waiting") console.log(`Channels UI: ${event.manifest.uiVersion} waits for the window to close or the next start`);
  else if (event.type === "booting") console.log(`Channels UI: booting ${event.manifest.uiVersion} (${event.reason})`);
  else console.log(`Channels UI: ${event.manifest.uiVersion} ${event.type}`);
}

export interface UiWindow {
  win: BrowserWindow;
  show(index: string): void;
}

export interface ChannelUi {
  start(): Promise<void>;
  started(): boolean;
  placeBuiltIn(): void;
}

export function channelUi(w: UiWindow): ChannelUi {
  if (!channel) throw new Error("this build shows only its built-in UI");
  const engine = new AppEngine({
    contractVersion: UI_CONTRACT,
    readyTimeoutMs: UI_READY_MS,
    channel: { ...channel, pollIntervalMs: devChannel ? 3_000 : UI_POLL_MS },
    host: {
      viewsRoot: uiViewsRoot(),
      prefix: UI_PREFIX,
      builtIn: { uiVersion: `built-in-${pkg.version}`, seq: KIWI_UI_SEQ, files: builtInFiles },
      show: (ui) => w.show(new TextDecoder().decode(ui.index)),
      canSwap: () => devChannel !== null || !w.win.isVisible(),
    },
  });
  engine.on(say);
  hearUi({ ready: () => engine.ready(), error: (message) => engine.error(message) });
  Electrobun.events.on("render-process-gone", () => engine.rendererGone());
  Electrobun.events.on(`will-close-${w.win.id}`, () =>
    setTimeout(() => {
      if (!w.win.isVisible()) engine.applyUpdate();
    }, 0),
  );
  let starting: Promise<void> | null = null;
  return {
    start: () => (starting ??= engine.start()),
    started: () => starting !== null,
    placeBuiltIn: () => {
      const files = builtInFiles();
      files.delete(INDEX);
      placeFiles(path.join(uiViewsRoot(), UI_PREFIX), files);
    },
  };
}
