import { useSyncExternalStore } from "react";

// Persisted accessibility toggles, per browser like the theme. Only
// reduce-motion for now; the module is shaped so dyslexic/bionic options
// can join without changing callers. New entry points call
// initAccessibility() before first render (see main.tsx).

export type AccessibilityOption = "reduce-motion" | "reduce-transparency";

const STORAGE_PREFIX = "kiwi:a11y:";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";

const listeners = new Set<() => void>();
let systemMotionWatched = false;
// Private browsing can refuse storage: the toggle then lasts this load.
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function accessibilityOptionEnabled(option: AccessibilityOption): boolean {
  return read(`${STORAGE_PREFIX}${option}`) === "on";
}

function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function reducedMotionActive(): boolean {
  return accessibilityOptionEnabled("reduce-motion") || systemPrefersReducedMotion();
}

function systemPrefersReducedTransparency(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_TRANSPARENCY_QUERY).matches;
}

function syncAccessibilityClasses(): void {
  document.documentElement.classList.toggle("reduce-motion", reducedMotionActive());
  document.documentElement.classList.toggle("reduce-transparency", accessibilityOptionEnabled("reduce-transparency") || systemPrefersReducedTransparency());
}

export function setAccessibilityOption(option: AccessibilityOption, enabled: boolean): void {
  write(`${STORAGE_PREFIX}${option}`, enabled ? "on" : "off");
  syncAccessibilityClasses();
  notify();
}

export function initAccessibility(): void {
  syncAccessibilityClasses();
  if (systemMotionWatched || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  systemMotionWatched = true;
  for (const query of [REDUCED_MOTION_QUERY, REDUCED_TRANSPARENCY_QUERY])
    window.matchMedia(query).addEventListener("change", () => {
      syncAccessibilityClasses();
      notify();
    });
}

export function useAccessibilityOption(option: AccessibilityOption): boolean {
  return useSyncExternalStore(
    subscribe,
    () => accessibilityOptionEnabled(option),
    () => false,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}
