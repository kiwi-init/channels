import { ipcMain } from "electron";

import { entryUrl } from "../serve-web.ts";
import { mutate, store } from "../store.ts";
import { voiceToken } from "../voice.ts";
import { currentWindow } from "../window.ts";

export function wireVoiceIpc(): void {
  ipcMain.handle("kiwi:voice-set-key", (_e, key: unknown) => {
    if (typeof key !== "string") throw new Error("bad voice key");
    const clean = key.trim().slice(0, 256);
    mutate((s) => {
      s.voice = { ...s.voice, key: clean.length ? clean : undefined };
    });
    currentWindow()?.loadURL(entryUrl());
  });
  ipcMain.handle("kiwi:voice-set-consent", (_e, roomId: unknown, on: unknown) => {
    if (typeof roomId !== "string" || !roomId || typeof on !== "boolean") throw new Error("bad voice consent");
    if (!store.channels.some((c) => c.roomId === roomId)) throw new Error("unknown channel");
    mutate((s) => {
      const consent = { ...(s.voice?.consent ?? {}) };
      if (on) consent[roomId] = true;
      else delete consent[roomId];
      s.voice = { ...s.voice, consent };
    });
    currentWindow()?.loadURL(entryUrl());
  });
  ipcMain.handle("kiwi:voice-token", (_e, roomId: unknown) => {
    if (typeof roomId !== "string" || !roomId) throw new Error("no consent");
    return voiceToken({
      key: store.voice?.key,
      consent: store.voice?.consent,
      roomId,
      http: (url, init) => fetch(url, init),
    });
  });
}
