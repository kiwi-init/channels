import type { Page } from "playwright-core";

export interface Calibration {
  ms: number;
  reps: number[];
}

export async function calibrateInPage(): Promise<Calibration> {
  const OWN_ROWS = 2700;
  const times: number[] = [];
  for (let r = 0; r < 5; r++) {
    await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
    const t0 = performance.now();
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;left:-20000px;top:0;width:720px;display:block";
    const rows = host.attachShadow({ mode: "closed" });
    for (let i = 0; i < OWN_ROWS; i++) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:6px 12px;font:13px/1.5 sans-serif";
      const who = document.createElement("span");
      who.style.cssText = "font-weight:500;color:#111";
      who.textContent = `agent-${i % 10}`;
      const body = document.createElement("p");
      body.style.cssText = "margin:0;min-width:0;flex:1 1 0%;color:#555;overflow-wrap:anywhere";
      body.textContent = `M${i}: ${"words in a message ".repeat(3 + (i % 9))}`;
      row.append(who, body);
      rows.append(row);
    }
    document.body.append(host);
    void host.offsetHeight;
    const items = Array.from({ length: 20000 }, (_, i) => ({ seq: (i * 7919) % 20011, body: `M${i}` }));
    items.sort((a, b) => a.seq - b.seq);
    void (JSON.parse(JSON.stringify(items)) as unknown[]).length;
    host.remove();
    times.push(performance.now() - t0);
  }
  const reps = times.map((t) => Math.round(t * 10) / 10);
  return { ms: [...reps].sort((a, b) => a - b)[2]!, reps };
}

export async function loopInPage(): Promise<number> {
  const times: number[] = [];
  let x = 0;
  for (let r = 0; r < 5; r++) {
    await new Promise((ok) => setTimeout(ok, 0));
    const t0 = performance.now();
    for (let i = 0; i < 5_000_000; i++) x = (x + i * 31) % 1_000_003;
    times.push(performance.now() - t0);
  }
  return x < 0 ? -1 : Math.round([...times].sort((a, b) => a - b)[2]! * 10) / 10;
}

export async function calibrate(page: Page): Promise<Calibration> {
  return page.evaluate(calibrateInPage);
}
