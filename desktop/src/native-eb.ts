import { dlopen, FFIType, JSCallback, ptr, suffix, type Pointer } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";

import { PAGE_URL } from "./eb-page.ts";
import { linuxWallpaper } from "./wallpaper-path.ts";

export const mac = process.platform === "darwin";

const windows = process.platform === "win32";

const linux = !mac && !windows;

const binDir = path.dirname(process.execPath);
const shellPath = path.join(binDir, `libkiwi-shell.${suffix}`);

const shell = windows
  ? null
  : dlopen(shellPath, {
      kiwi_deny_permissions: { args: [], returns: FFIType.bool },
      kiwi_watch_commits: { args: [], returns: FFIType.bool },
      kiwi_committed_url: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols;

function webview2Guards() {
  try {
    return dlopen(path.join(binDir, "libNativeWrapper.dll"), {
      webview2DenyPermissions: { args: [], returns: FFIType.bool },
      webview2OwnDownloadsOnly: { args: [], returns: FFIType.bool },
      webview2AllowOnly: { args: [FFIType.ptr], returns: FFIType.bool },
      webview2KeepWebSecurity: { args: [], returns: FFIType.bool },
      webview2CommittedUrl: { args: [FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    }).symbols;
  } catch {
    // An Electrobun wrapper older than the guards has none of these: missingGuard says so, and no window opens.
    return null;
  }
}

const webview2 = windows ? webview2Guards() : null;

const sandboxPages = linux ? dlopen(shellPath, { kiwi_sandbox_pages: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages : null;

const lookShell = windows ? null : dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols;

export const windowLook = (win: Pointer, minWidth: number, minHeight: number, light: number, dark: number): void => void lookShell?.kiwi_window_look(win, minWidth, minHeight, light, dark);

const clearShell = linux ? dlopen(shellPath, { kiwi_window_clear: { args: [], returns: FFIType.void } }).symbols : null;

export const clearWindow = (): void => void clearShell?.kiwi_window_clear();

const frostShell = mac
  ? dlopen(shellPath, {
      kiwi_window_frost: { args: [FFIType.ptr, FFIType.function], returns: FFIType.bool },
      kiwi_frost_allowed: { args: [], returns: FFIType.bool },
      kiwi_frost_force_for_test: { args: [FFIType.i32], returns: FFIType.void },
      kiwi_frost_opaque_for_test: { args: [FFIType.i32], returns: FFIType.void },
      kiwi_window_appearance: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.void },
      kiwi_window_looks: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

export const frostAllowed = (): boolean => frostShell?.kiwi_frost_allowed() ?? false;

export const forceFrostForTest = (frost: boolean): void => void frostShell?.kiwi_frost_force_for_test(frost ? 1 : 0);

export const opaqueForTest = (opaque: boolean): void => void frostShell?.kiwi_frost_opaque_for_test(opaque ? 1 : 0);

let frostChanges: JSCallback | null = null;

export function frostWindow(win: Pointer, changed: (on: boolean) => void): boolean {
  if (!frostShell) return false;
  frostChanges = new JSCallback((on: boolean) => changed(on), { args: ["bool"], returns: "void", threadsafe: true });
  return frostShell.kiwi_window_frost(win, frostChanges.ptr);
}

export const windowAppearance = (win: Pointer, appearance: number): void => void frostShell?.kiwi_window_appearance(win, appearance);

const looksBuffer = new Uint8Array(64);

export function windowLooks(): string {
  if (!frostShell) return "";
  const n = Number(frostShell.kiwi_window_looks(ptr(looksBuffer), looksBuffer.length));
  return n > 0 && n < looksBuffer.length ? new TextDecoder().decode(looksBuffer.subarray(0, n)) : "";
}

const wallpaperShell = mac
  ? dlopen(shellPath, { kiwi_wallpaper_pixels: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 } }).symbols
  : linux
    ? dlopen(shellPath, {
        kiwi_image_pixels: { args: [FFIType.cstring, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
        kiwi_image_pixels_sized: { args: [FFIType.cstring, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
      }).symbols
    : null;

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
  if (!wallpaperShell || !("kiwi_image_pixels_sized" in wallpaperShell)) return null;
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
  if (!wallpaperShell) return null;
  if ("kiwi_wallpaper_pixels" in wallpaperShell) {
    const out = new Uint8Array(WALLPAPER_BYTES);
    return Number(wallpaperShell.kiwi_wallpaper_pixels(ptr(out), out.length)) === out.length ? out : null;
  }
  const file = await linuxWallpaper(dark);
  return file ? decodeOnce(file, 24, 24) : null;
}

const trayHost = linux ? dlopen(shellPath, { kiwi_tray_host: { args: [], returns: FFIType.bool } }).symbols.kiwi_tray_host : null;

const colorScheme = linux ? dlopen(shellPath, { kiwi_follow_color_scheme: { args: [], returns: FFIType.bool } }).symbols.kiwi_follow_color_scheme : null;

const drops = linux
  ? dlopen(shellPath, {
      kiwi_watch_drops: { args: [], returns: FFIType.bool },
      kiwi_take_drop: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

const dropBuffer = new Uint8Array(65536);

export const watchDrops = (): void => void drops?.kiwi_watch_drops();

export function droppedPaths(): string[] {
  if (!drops) return [];
  const n = Number(drops.kiwi_take_drop(ptr(dropBuffer), dropBuffer.length));
  if (n <= 0 || n >= dropBuffer.length) return [];
  return new TextDecoder().decode(dropBuffer.subarray(0, n)).split("\n").filter(Boolean);
}

const paste = linux
  ? dlopen(shellPath, {
      kiwi_watch_paste: { args: [], returns: FFIType.bool },
      kiwi_take_paste: { args: [], returns: FFIType.u64 },
      kiwi_paste_bytes: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    }).symbols
  : null;

export const watchPaste = (): void => void paste?.kiwi_watch_paste();

export function pastedPng(max: number): Uint8Array | null {
  if (!paste) return null;
  const n = Number(paste.kiwi_take_paste());
  if (n <= 0) return null;
  const out = new Uint8Array(n <= max ? n : 1);
  return Number(paste.kiwi_paste_bytes(ptr(out), n <= max ? n : 0)) === n ? out : null;
}

const windowKeys = linux ? dlopen(shellPath, { kiwi_window_keys: { args: [FFIType.ptr, FFIType.function], returns: FFIType.bool } }).symbols.kiwi_window_keys : null;

let shortcuts: JSCallback | null = null;

const guards = windows ? null : dlopen(shellPath, { kiwi_guard_downloads: { args: [], returns: FFIType.bool }, kiwi_allow_only: { args: [FFIType.ptr], returns: FFIType.bool } }).symbols;

const core = dlopen(path.join(binDir, windows ? "ElectrobunCore.dll" : `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  updatePreloadScriptToWebView: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols;

export const cString = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`${s}\0`);

const PRELOAD_ID = cString("electrobun_custom_preload_script");

const PAGE_ONLY = cString(PAGE_URL);

const committedBuffer = new Uint8Array(4096);

export function committedPage(view: number | undefined): string | null {
  const n = shell
    ? Number(shell.kiwi_committed_url(ptr(committedBuffer), committedBuffer.length))
    : webview2 && view !== undefined
      ? webview2.webview2CommittedUrl(view, ptr(committedBuffer), committedBuffer.length)
      : 0;
  return n > 0 && n < committedBuffer.length ? new TextDecoder().decode(committedBuffer.subarray(0, n)) : null;
}

export const setPageHtml = (view: number, html: Uint8Array<ArrayBuffer>): void => core.setWebviewHTMLContent(view, html);

export const setPreload = (view: number, source: string): void => core.updatePreloadScriptToWebView(view, PRELOAD_ID, cString(source), false);

function missingWebview2Guard(): string | null {
  if (!webview2) return "this build's WebView2 wrapper has no guards; not opening a window that could grant the microphone, save any file or navigate away";
  if (!webview2.webview2KeepWebSecurity()) return "WebView2 already runs with web security off; not opening a window whose page could read other sites";
  if (!webview2.webview2DenyPermissions()) return "the web view's permission handler wasn't found; not opening a window that could grant the microphone";
  if (!webview2.webview2OwnDownloadsOnly()) return "the web view's download handler wasn't found; not opening a window that could save any file into Downloads";
  if (!webview2.webview2AllowOnly(PAGE_ONLY)) return "the web view's navigation handler wasn't found; not opening a window whose page could navigate away";
  return null;
}

export function missingGuard(): string | null {
  if (!shell || !guards) return missingWebview2Guard();
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

const badge = windows ? null : dlopen(shellPath, { kiwi_badge: { args: [FFIType.i32], returns: mac ? FFIType.void : FFIType.bool } }).symbols.kiwi_badge;

export const showBadge = (count: number): void => void badge?.(Math.max(0, Math.min(Math.trunc(count), 1_000_000)));

export function sandboxOff(): string | null {
  if (!sandboxPages) return null;
  const why = new Uint8Array(1024);
  return sandboxPages(ptr(why), why.length) ? null : new TextDecoder().decode(why.subarray(0, Math.max(0, why.indexOf(0))));
}
