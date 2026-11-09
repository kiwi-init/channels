for (const button of document.querySelectorAll(".code .copy")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    const text = button.parentElement?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = button.dataset.copied ?? "copied";
    } catch {
      // The clipboard can be refused (an insecure page, a denied permission): say so on the button.
      button.textContent = button.dataset.failed ?? "can't copy";
    }
    setTimeout(() => (button.textContent = label), 1600);
  });
}

const demo = document.querySelector("iframe.demo-app");
if (demo) {
  const load = () => {
    const theme = document.documentElement.dataset.theme;
    demo.src = theme === "light" || theme === "dark" ? `/demo/?theme=${theme}` : "/demo/";
  };
  load();
  new MutationObserver(load).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
