import { dlopen, FFIType, ptr, suffix, type JSCallback } from "bun:ffi";
import path from "node:path";

import { PAGE_URL } from "./eb-page.ts";
import { mark } from "./eb-startup.ts";

export const mac = process.platform === "darwin";

const binDir = path.dirname(process.execPath);
const shellPath = path.join(binDir, `libkiwi-shell.${suffix}`);

const shell = dlopen(shellPath, {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_watch_commits: { args: [], returns: FFIType.bool },
  kiwi_committed_url: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  kiwi_watch_page: { args: [FFIType.function], returns: FFIType.bool },
}).symbols;

const webkit = mac
  ? dlopen(shellPath, {
      kiwi_prewarm_page: { args: [], returns: FFIType.bool },
      kiwi_navigation_times: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

if (webkit?.kiwi_prewarm_page()) mark("prewarm");

export function navigationTimes(): Record<string, number> {
  if (!webkit) return {};
  const times = new Float64Array(4);
  const named = (which: number, name: string): [string, number][] =>
    [...times.subarray(0, Number(webkit.kiwi_navigation_times(which, ptr(times), times.length)))].map((t, i) => [`${name}${i + 1}`, t]);
  return Object.fromEntries([...named(0, "decided"), ...named(1, "committed")]);
}

const sandboxPages = mac ? null : dlopen(shellPath, { kiwi_sandbox_pages: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages;

export const windowLook = mac
  ? dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols.kiwi_window_look
  : null;

const guards = dlopen(shellPath, { kiwi_guard_downloads: { args: [], returns: FFIType.bool }, kiwi_allow_only: { args: [FFIType.ptr], returns: FFIType.bool } }).symbols;

const core = dlopen(path.join(binDir, `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  updatePreloadScriptToWebView: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols;

export const cString = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const PRELOAD_ID = cString("electrobun_custom_preload_script");

const PAGE_ONLY = cString(PAGE_URL);

const committedBuffer = new Uint8Array(4096);

export function committedPage(): string | null {
  const n = Number(shell.kiwi_committed_url(ptr(committedBuffer), committedBuffer.length));
  return n > 0 && n < committedBuffer.length ? new TextDecoder().decode(committedBuffer.subarray(0, n)) : null;
}

export const setPageHtml = (view: number, html: Uint8Array): void => core.setWebviewHTMLContent(view, ptr(html));

export const setPreload = (view: number, source: string): void => core.updatePreloadScriptToWebView(view, ptr(PRELOAD_ID), ptr(cString(source)), false);

export function missingGuard(): string | null {
  if (!shell.kiwi_deny_permissions()) return "the web view's permission handler wasn't found; not opening a window that could grant the microphone";
  if (!guards.kiwi_guard_downloads()) return "the web view's download handler wasn't found; not opening a window that could save any file into Downloads";
  if (!guards.kiwi_allow_only(ptr(PAGE_ONLY))) return "the web view's navigation handler wasn't found; not opening a window whose page could navigate away";
  if (!shell.kiwi_watch_commits()) return "the web view's navigation delegate wasn't found; not opening a window that would trust a page it can't see";
  return null;
}

export const watchPageGone = (gone: JSCallback): boolean => shell.kiwi_watch_page(gone);

export function sandboxOff(): string | null {
  if (!sandboxPages) return null;
  const why = new Uint8Array(1024);
  return sandboxPages(ptr(why), why.length) ? null : new TextDecoder().decode(why.subarray(0, Math.max(0, why.indexOf(0))));
}
