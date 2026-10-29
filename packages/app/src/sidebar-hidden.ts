import { useEffect, useSyncExternalStore } from "react";

const KEY = "mc.sidebar-hidden";
const listeners = new Set<() => void>();
let unsaved = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // No storage (a private window, a test): what was toggled since the page loaded.
    return unsaved;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export const useSidebarHidden = (): boolean => useSyncExternalStore(subscribe, read, read);

function setSidebarHidden(hidden: boolean) {
  unsaved = hidden;
  try {
    if (hidden) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // No storage: the toggle still works until the page reloads.
  }
  for (const l of listeners) l();
}

export const toggleSidebar = () => setSidebarHidden(!read());

export const SIDEBAR_KEYS = "⌘\\";

export function useSidebarShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
