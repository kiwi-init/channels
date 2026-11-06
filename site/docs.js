for (const button of document.querySelectorAll(".code .copy")) {
  button.addEventListener("click", async () => {
    const text = button.parentElement?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "copied";
    } catch {
      // The clipboard can be refused (an insecure page, a denied permission): say so on the button.
      button.textContent = "can't copy";
    }
    setTimeout(() => (button.textContent = "copy"), 1600);
  });
}
