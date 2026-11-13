import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";

const dir = resolve(process.argv[2] ?? "flicker-out");
const pairs = readdirSync(dir)
  .filter((f) => f.endsWith("ms.png"))
  .sort();
const browser = await webkit.launch();
const page = await browser.newPage();
const out: string[] = [];
for (const after of pairs) {
  const before = after.replace(/\.png$/, "-before.png");
  const a = `data:image/png;base64,${readFileSync(join(dir, before)).toString("base64")}`;
  const b = `data:image/png;base64,${readFileSync(join(dir, after)).toString("base64")}`;
  const r = await page.evaluate(
    async ([x, y]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((ok) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = ia.width;
      const h = ia.height;
      const px = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d");
        if (!g) return new Uint8ClampedArray();
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const da = px(ia);
      const db = px(ib);
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > 24) {
          n++;
          const p = i / 4;
          const px0 = p % w;
          const py0 = Math.floor(p / w);
          x0 = Math.min(x0, px0);
          y0 = Math.min(y0, py0);
          x1 = Math.max(x1, px0);
          y1 = Math.max(y1, py0);
        }
      }
      return { w, h, n, box: n ? `${x0},${y0}-${x1},${y1}` : "none" };
    },
    [a, b] as const,
  );
  out.push(`${after}: ${r.w}x${r.h}, ${r.n} pixels changed, box ${r.box}`);
}
await browser.close();
writeFileSync(join(dir, "diffs.txt"), `${out.join("\n")}\n`);
console.log(out.join("\n"));
