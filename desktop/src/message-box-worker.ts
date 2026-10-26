import { dlopen, FFIType, ptr } from "bun:ffi";
import { parentPort } from "node:worker_threads";

export interface BoxAsk {
  lib: string;
  type: string;
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

const port = parentPort;
if (!port) throw new Error("the message box worker runs only inside a Worker");

const text = (s: string): Buffer => Buffer.from(`${s}\0`, "utf8");

port.on("message", (ask: BoxAsk) => {
  const lib = dlopen(ask.lib, {
    showMessageBox: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.int, FFIType.int], returns: FFIType.int },
  });
  const type = text(ask.type);
  const title = text(ask.title);
  const message = text(ask.message);
  const detail = text(ask.detail);
  const buttons = text(ask.buttons.join(","));
  const response = lib.symbols.showMessageBox(ptr(type), ptr(title), ptr(message), ptr(detail), ptr(buttons), ask.defaultId, ask.cancelId);
  port.postMessage(response);
});
