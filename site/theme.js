const KEY = "channels-theme";
const COLOR = { light: "#ffffff", dark: "#151011" };
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");
let forced = new URLSearchParams(location.search).get("theme");

function chosen() {
  if (forced === "system" || forced === "light" || forced === "dark") return forced;
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Storage is blocked (a private window, cookies off): the page follows the system.
    return "system";
  }
}

function save(choice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage is blocked: the choice holds for this page only.
  }
}

function apply(choice) {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  const look = choice === "system" ? (system.matches ? "dark" : "light") : choice;
  const changed = root.dataset.look !== look;
  root.dataset.look = look;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", COLOR[look]);
  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-pick") === choice));
  if (changed) dispatchEvent(new CustomEvent("channels-theme", { detail: look }));
}

apply(chosen());
system.addEventListener("change", () => apply(chosen()));
addEventListener("storage", (e) => {
  if (e.key === KEY) apply(chosen());
});
document.addEventListener("DOMContentLoaded", () => {
  apply(chosen());
  for (const b of document.querySelectorAll("[data-theme-pick]")) {
    b.addEventListener("click", () => {
      const choice = b.getAttribute("data-theme-pick") ?? "system";
      forced = null;
      save(choice);
      apply(choice);
    });
  }
});
