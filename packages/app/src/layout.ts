import { useSyncExternalStore } from "react";

export type Layout = "side" | "top";

const KEY = "channels.layout";
const listeners = new Set<() => void>();
let unsaved: Layout = "side";

function read(): Layout {
  try {
    return localStorage.getItem(KEY) === "top" ? "top" : "side";
  } catch {
    // No storage (a private window, a test): what was picked since the page loaded.
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

export const useLayout = (): Layout => useSyncExternalStore(subscribe, read, read);

export function setLayout(layout: Layout) {
  unsaved = layout;
  try {
    if (layout === "top") localStorage.setItem(KEY, layout);
    else localStorage.removeItem(KEY);
  } catch {
    // No storage: the pick still holds until the page reloads.
  }
  for (const l of listeners) l();
}
