import { suffix } from "bun:ffi";
import path from "node:path";
import { Utils } from "electrobun/main";

import { logMainError } from "./main-log.ts";
import type { BoxAsk } from "./message-box-worker.ts";

export interface MessageBox {
  type: "info" | "warning" | "error" | "question";
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

const boxAsk = (box: MessageBox, lib: string): BoxAsk => ({
  lib,
  type: box.type,
  title: "",
  message: box.message,
  detail: box.detail ?? "",
  buttons: box.buttons ?? ["OK"],
  defaultId: box.defaultId ?? 0,
  cancelId: box.cancelId ?? -1,
});

export function messageBox(box: MessageBox): Promise<number> {
  if (process.platform !== "linux") return Utils.showMessageBox(box).then((r: { response: number }) => r.response);
  const ask = boxAsk(box, path.join(path.dirname(process.execPath), `libNativeWrapper.${suffix}`));
  const worker = new Worker(path.join(import.meta.dir, "message-box.js"));
  return new Promise((resolve) => {
    worker.addEventListener("message", (e: MessageEvent<number>) => {
      resolve(e.data);
      worker.terminate();
    });
    worker.addEventListener("error", (e) => {
      logMainError(new Error(`a message box couldn't show: ${e.message}`));
      resolve(ask.cancelId);
      worker.terminate();
    });
    worker.postMessage(ask);
  });
}
