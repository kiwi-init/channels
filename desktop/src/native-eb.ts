import { dlopen, FFIType, JSCallback, ptr, suffix, type Pointer } from "bun:ffi";
import path from "node:path";

import { PAGE_URL } from "./eb-page.ts";

export const mac = process.platform === "darwin";

const binDir = path.dirname(process.execPath);
const shellPath = path.join(binDir, `libkiwi-shell.${suffix}`);

const shell = dlopen(shellPath, {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_watch_commits: { args: [], returns: FFIType.bool },
  kiwi_committed_url: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  kiwi_watch_page: { args: [FFIType.function], returns: FFIType.bool },
}).symbols;

const sandboxPages = mac ? null : dlopen(shellPath, { kiwi_sandbox_pages: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages;

export const windowLook = dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols.kiwi_window_look;

const frostShell = mac
  ? dlopen(shellPath, {
      kiwi_window_frost: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
      kiwi_look_setting: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

export const frostWindow = (win: Pointer, appearance: number): boolean => frostShell?.kiwi_window_frost(win, appearance) ?? false;

const settingBuffer = new Uint8Array(256);

export function lookSetting(key: string): string {
  if (!frostShell) return "";
  const n = Number(frostShell.kiwi_look_setting(ptr(cString(key)), ptr(settingBuffer), settingBuffer.length));
  return n > 0 && n < settingBuffer.length ? new TextDecoder().decode(settingBuffer.subarray(0, n)) : "";
}

const trayHost = mac ? null : dlopen(shellPath, { kiwi_tray_host: { args: [], returns: FFIType.bool } }).symbols.kiwi_tray_host;

const colorScheme = mac ? null : dlopen(shellPath, { kiwi_follow_color_scheme: { args: [], returns: FFIType.bool } }).symbols.kiwi_follow_color_scheme;

const drops = mac
  ? null
  : dlopen(shellPath, {
      kiwi_watch_drops: { args: [], returns: FFIType.bool },
      kiwi_take_drop: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols;

const dropBuffer = new Uint8Array(65536);

export const watchDrops = (): void => void drops?.kiwi_watch_drops();

export function droppedPaths(): string[] {
  if (!drops) return [];
  const n = Number(drops.kiwi_take_drop(ptr(dropBuffer), dropBuffer.length));
  if (n <= 0 || n >= dropBuffer.length) return [];
  return new TextDecoder().decode(dropBuffer.subarray(0, n)).split("\n").filter(Boolean);
}

const paste = mac
  ? null
  : dlopen(shellPath, {
      kiwi_watch_paste: { args: [], returns: FFIType.bool },
      kiwi_take_paste: { args: [], returns: FFIType.u64 },
      kiwi_paste_bytes: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols;

export const watchPaste = (): void => void paste?.kiwi_watch_paste();

export function pastedPng(max: number): Uint8Array | null {
  if (!paste) return null;
  const n = Number(paste.kiwi_take_paste());
  if (n <= 0) return null;
  const out = new Uint8Array(n <= max ? n : 1);
  return Number(paste.kiwi_paste_bytes(ptr(out), n <= max ? n : 0)) === n ? out : null;
}

const windowKeys = mac ? null : dlopen(shellPath, { kiwi_window_keys: { args: [FFIType.ptr, FFIType.function], returns: FFIType.bool } }).symbols.kiwi_window_keys;

let shortcuts: JSCallback | null = null;

const notes = mac ? null : dlopen(shellPath, { kiwi_notify: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool } }).symbols;

const noteClicksOf = dlopen(shellPath, { kiwi_notify_clicks: { args: [FFIType.ptr, FFIType.function], returns: FFIType.bool } }).symbols.kiwi_notify_clicks;

let noteClicks: JSCallback | null = null;

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

export const hasTrayHost = (): boolean => trayHost?.() ?? true;

export const followColorScheme = (): void => void colorScheme?.();

export function onShortcut(window: Pointer | null, pressed: (action: number) => void): boolean {
  if (!windowKeys || !window) return false;
  shortcuts = new JSCallback((action: number) => pressed(action), { args: ["i32"], returns: "void", threadsafe: true });
  return windowKeys(window, shortcuts.ptr);
}

const badge = dlopen(shellPath, { kiwi_badge: { args: [FFIType.i32], returns: mac ? FFIType.void : FFIType.bool } }).symbols.kiwi_badge;

export const showBadge = (count: number): void => void badge(Math.max(0, Math.min(Math.trunc(count), 1_000_000)));

export const notifyLinux = (title: string, body: string): boolean => notes?.kiwi_notify(ptr(cString(title)), ptr(cString(body))) ?? false;

export function onNoteClick(window: Pointer | null, clicked: () => void): boolean {
  if (!window) return false;
  noteClicks = new JSCallback(() => clicked(), { args: [], returns: "void", threadsafe: true });
  return noteClicksOf(window, noteClicks.ptr);
}

export const watchPageGone = (gone: JSCallback): boolean => shell.kiwi_watch_page(gone);

export function sandboxOff(): string | null {
  if (!sandboxPages) return null;
  const why = new Uint8Array(1024);
  return sandboxPages(ptr(why), why.length) ? null : new TextDecoder().decode(why.subarray(0, Math.max(0, why.indexOf(0))));
}
