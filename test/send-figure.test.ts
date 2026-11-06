import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFigure, MAX_FIGURE_BYTES } from "../src/figure.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-figure-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CSS = `.iso{--anatomy-paper:#131313;--anatomy-hi:#e6e6e6}
.iso[data-theme="light"]{--anatomy-paper:#fbfbfa;--anatomy-hi:#26262a}
@media (prefers-reduced-motion: reduce){.iso *{transition:none}}
.iso-svg{display:block}`;

function pageOf(title: string, theme: "dark" | "light", extra = ""): string {
  return `<!doctype html><html><head><title>${title}</title><style>${CSS}</style><style>body{margin:0}</style></head>
<body class="iso" data-theme="${theme}"><div class="iso-plate"><svg class="iso-swatch" viewBox="0 0 16 10"><path d="M0 0"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg" viewBox="0 0 600 380" role="img" aria-label="A gauge"><g class="base"><svg viewBox="0 0 4 4"><circle r="1"/></svg><path d="M1 1L2 2"/></g></svg>
${extra}</div><script>const css = "<style>\${ISO_CSS}</style>";</script></body></html>`;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("a figure is its page, the light page beside it and a snapshot that follows the viewer's appearance (T6870)", () => {
  writeFileSync(join(dir, "gauge.html"), pageOf("Dial &amp; gauge", "dark"));
  writeFileSync(join(dir, "gauge-light.html"), pageOf("Dial &amp; gauge", "light"));
  const fig = loadFigure(join(dir, "gauge.html"));
  expect(fig.title).toBe("Dial & gauge");
  expect(fig.files.map((f) => [f.name, f.mime])).toEqual([
    ["gauge.figure.html", "text/html"],
    ["gauge.figure-light.html", "text/html"],
    ["gauge.figure.svg", "image/svg+xml"],
  ]);
  expect(text(fig.files[1]!.bytes)).toContain('data-theme="light"');
  const svg = text(fig.files[2]!.bytes);
  expect(svg.startsWith('<svg width="600" height="380" xmlns="http://www.w3.org/2000/svg" class="iso-svg iso" viewBox="0 0 600 380"')).toBe(true);
  expect(svg).toContain("@media (prefers-color-scheme: light){.iso{--anatomy-paper:#fbfbfa;--anatomy-hi:#26262a}}");
  expect(svg).toContain("@media (prefers-reduced-motion: reduce){.iso *{transition:none}}");
  expect(svg).not.toContain("data-theme");
  expect(svg.endsWith('<circle r="1"/></svg><path d="M1 1L2 2"/></g></svg>')).toBe(true);
  expect(svg).not.toContain("iso-swatch");
  expect(svg).not.toContain("<script");
  expect(loadFigure(join(dir, "gauge-light.html")).files.map((f) => f.name)).toEqual(["gauge.figure.html", "gauge.figure-light.html", "gauge.figure.svg"]);
});

test("a figure with one page sends that page alone, and a snapshot beside it wins over the one cut from the page (T6870)", () => {
  writeFileSync(join(dir, "lone-light.html"), pageOf("Lone", "light"));
  const lone = loadFigure(join(dir, "lone-light.html"));
  expect(lone.files.map((f) => f.name)).toEqual(["lone.figure.html", "lone.figure.svg"]);
  expect(text(lone.files[0]!.bytes)).toContain('data-theme="light"');

  writeFileSync(join(dir, "built.html"), pageOf("", "dark"));
  writeFileSync(join(dir, "built.svg"), '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>');
  const built = loadFigure(join(dir, "built.html"));
  expect(built.title).toBe("built");
  expect(text(built.files.at(-1)!.bytes)).toContain('<rect width="2" height="2"/>');

  writeFileSync(join(dir, "wrong.html"), pageOf("Wrong", "dark"));
  writeFileSync(join(dir, "wrong.svg"), "<html>not a picture</html>");
  expect(() => loadFigure(join(dir, "wrong.html"))).toThrow("wrong.svg isn't an SVG");
});

test("--figure refuses what isn't an anatomy page, a missing page and one over the cap (T6870)", () => {
  expect(() => loadFigure(join(dir, "gauge.svg"))).toThrow("--figure takes the .html page the anatomy skill builds");
  expect(() => loadFigure(join(dir, "nowhere.html"))).toThrow("no such page");
  writeFileSync(join(dir, "plain.html"), "<!doctype html><title>Plain</title><p>No figure here.</p>");
  expect(() => loadFigure(join(dir, "plain.html"))).toThrow('plain.html has no anatomy figure in it (no <svg class="iso-svg">)');
  writeFileSync(join(dir, "huge.html"), pageOf("Huge", "dark", `<!-- ${"x".repeat(MAX_FIGURE_BYTES / 2)} -->`));
  writeFileSync(join(dir, "huge-light.html"), pageOf("Huge", "light", `<!-- ${"x".repeat(MAX_FIGURE_BYTES / 2)} -->`));
  expect(() => loadFigure(join(dir, "huge.html"))).toThrow("a figure is at most 8 MB");
});
