async function load(figure) {
  const name = figure.getAttribute("data-figure");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  try {
    const res = await fetch(`/docs/figures/${name}.svg`);
    if (!res.ok) return;
    figure.innerHTML = await res.text();
    figure.classList.add("is-in");
    if (figure.hasAttribute("data-live")) await import(`/figures/${name}/live.js`);
  } catch {
    // A figure that fails to load leaves its empty frame: the words around it still say everything.
  }
}

const near = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      near.unobserve(entry.target);
      load(entry.target);
    }
  },
  { rootMargin: "600px 0px" },
);

for (const figure of document.querySelectorAll("figure[data-figure]")) near.observe(figure);
