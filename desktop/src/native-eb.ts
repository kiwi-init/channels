import { dlopen, FFIType, JSCallback, ptr, suffix, type Pointer } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";

import { PAGE_URL } from "./eb-page.ts";
import { linuxWallpaper } from "./wallpaper-path.ts";

export const mac = process.platform === "darwin";

const binDir = path.dirname(process.execPath);
const shellPath = path.join(binDir, `libkiwi-shell.${suffix}`);

const shell = dlopen(shellPath, {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_watch_commits: { args: [], returns: FFIType.bool },
  kiwi_committed_url: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
}).symbols;

const sandboxPages = mac ? null : dlopen(shellPath, { kiwi_sandbox_pages: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages;

export const windowLook = dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols.kiwi_window_look;

const clearShell = mac ? null : dlopen(shellPath, { kiwi_window_clear: { args: [], returns: FFIType.void } }).symbols;

export const clearWindow = (): void => void clearShell?.kiwi_window_clear();

const frostShell = mac
  ? dlopen(shellPath, {
      kiwi_window_frost: { args: [FFIType.ptr, FFIType.function], returns: FFIType.bool },
      kiwi_frost_allowed: { args: [], returns: FFIType.bool },
      kiwi_frost_force_for_test: { args: [FFIType.i32], returns: FFIType.void },
      kiwi_window_appearance: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.void },
      kiwi_window_looks: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

let frostChanges: JSCallback | null = null;

export function frostWindow(win: Pointer, changed: (on: boolean) => void): boolean {
  if (!frostShell) return false;
  frostChanges = new JSCallback((on: boolean) => changed(on), { args: ["bool"], returns: "void", threadsafe: true });
  return frostShell.kiwi_window_frost(win, frostChanges.ptr);
}

export const frostAllowed = (): boolean => frostShell?.kiwi_frost_allowed() ?? false;

export const forceFrostForTest = (frost: boolean): void => void frostShell?.kiwi_frost_force_for_test(frost ? 1 : 0);

export const windowAppearance = (win: Pointer, appearance: number): void => void frostShell?.kiwi_window_appearance(win, appearance);

const looksBuffer = new Uint8Array(64);

export function windowLooks(): string {
  if (!frostShell) return "";
  const n = Number(frostShell.kiwi_window_looks(ptr(looksBuffer), looksBuffer.length));
  return n > 0 && n < looksBuffer.length ? new TextDecoder().decode(looksBuffer.subarray(0, n)) : "";
}

const wallpaperShell = mac
  ? dlopen(shellPath, { kiwi_wallpaper_pixels: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 } }).symbols
  : dlopen(shellPath, {
      kiwi_image_pixels: { args: [FFIType.cstring, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
      kiwi_image_pixels_sized: { args: [FFIType.cstring, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols;

const WALLPAPER_BYTES = 24 * 24 * 4;

const decoded = new Map<string, Uint8Array | null>();

function stampOf(file: string): string | null {
  try {
    return String(fs.statSync(file).mtimeMs);
  } catch {
    // The wallpaper moved or went away since its path was read: nothing to draw.
    return null;
  }
}

function decodeOnce(file: string, width: number, height: number): Uint8Array | null {
  if (!("kiwi_image_pixels_sized" in wallpaperShell)) return null;
  const stamp = stampOf(file);
  if (stamp === null) return null;
  const key = `${file}\0${stamp}\0${width}x${height}`;
  if (decoded.has(key)) return decoded.get(key) ?? null;
  const out = new Uint8Array(width * height * 4);
  const got = Number(wallpaperShell.kiwi_image_pixels_sized(ptr(Buffer.from(`${file}\0`)), width, height, ptr(out), out.length)) === out.length ? out : null;
  decoded.set(key, got);
  return got;
}

export async function wallpaperImage(dark: boolean, width: number, height: number): Promise<Uint8Array | null> {
  const file = await linuxWallpaper(dark);
  return file ? decodeOnce(file, width, height) : null;
}

export async function wallpaperPixels(dark: boolean): Promise<Uint8Array | null> {
  if ("kiwi_wallpaper_pixels" in wallpaperShell) {
    const out = new Uint8Array(WALLPAPER_BYTES);
    return Number(wallpaperShell.kiwi_wallpaper_pixels(ptr(out), out.length)) === out.length ? out : null;
  }
  const file = await linuxWallpaper(dark);
  return file ? decodeOnce(file, 24, 24) : null;
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

export const cString = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`${s}\0`);

const PRELOAD_ID = cString("electrobun_custom_preload_script");

const PAGE_ONLY = cString(PAGE_URL);

const committedBuffer = new Uint8Array(4096);

export function committedPage(): string | null {
  const n = Number(shell.kiwi_committed_url(ptr(committedBuffer), committedBuffer.length));
  return n > 0 && n < committedBuffer.length ? new TextDecoder().decode(committedBuffer.subarray(0, n)) : null;
}

export const setPageHtml = (view: number, html: Uint8Array<ArrayBuffer>): void => core.setWebviewHTMLContent(view, html);

export const setPreload = (view: number, source: string): void => core.updatePreloadScriptToWebView(view, PRELOAD_ID, cString(source), false);

export function missingGuard(): string | null {
  if (!shell.kiwi_deny_permissions()) return "the web view's permission handler wasn't found; not opening a window that could grant the microphone";
  if (!guards.kiwi_guard_downloads()) return "the web view's download handler wasn't found; not opening a window that could save any file into Downloads";
  if (!guards.kiwi_allow_only(PAGE_ONLY)) return "the web view's navigation handler wasn't found; not opening a window whose page could navigate away";
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

export const notifyLinux = (title: string, body: string): boolean => notes?.kiwi_notify(cString(title), cString(body)) ?? false;

export function onNoteClick(window: Pointer | null, clicked: () => void): boolean {
  if (!window) return false;
  noteClicks = new JSCallback(() => clicked(), { args: [], returns: "void", threadsafe: true });
  return noteClicksOf(window, noteClicks.ptr);
}

export function sandboxOff(): string | null {
  if (!sandboxPages) return null;
  const why = new Uint8Array(1024);
  return sandboxPages(ptr(why), why.length) ? null : new TextDecoder().decode(why.subarray(0, Math.max(0, why.indexOf(0))));
}
