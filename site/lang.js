(() => {
  const KEY = "kiwi.site-lang";
  const DIRS = ["pt-br", "ja", "ko", "zh-cn"];
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      // No storage (private mode, blocked site data): the browser's language decides each visit.
      return null;
    }
  };
  const keep = (dir) => {
    try {
      localStorage.setItem(KEY, dir);
    } catch {
      // No storage: the pick holds for this page only, which is harmless.
    }
  };
  const fromBrowser = () => {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const t = String(tag).toLowerCase();
      if (t.startsWith("en")) return "en";
      if (t.startsWith("pt")) return "pt-br";
      if (t.startsWith("ja")) return "ja";
      if (t.startsWith("ko")) return "ko";
      if (t === "zh" || t.startsWith("zh-cn") || t.startsWith("zh-hans") || t.startsWith("zh-sg")) return "zh-cn";
    }
    return "en";
  };
  if (location.pathname === "/") {
    const want = read() ?? fromBrowser();
    if (DIRS.includes(want)) {
      keep(want);
      location.replace(`/${want}/${location.search}${location.hash}`);
      return;
    }
  }
  document.addEventListener("click", (e) => {
    const pick = e.target instanceof Element ? e.target.closest("[data-lang-pick]") : null;
    if (pick) keep(pick.getAttribute("data-lang-pick") ?? "en");
  });
})();
