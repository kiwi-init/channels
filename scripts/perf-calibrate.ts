import type { Page } from "playwright-core";

export async function calibrate(page: Page): Promise<{ ms: number; reps: number[] }> {
  return page.evaluate(async () => {
    const times: number[] = [];
    for (let r = 0; r < 5; r++) {
      await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
      const t0 = performance.now();
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-20000px;top:0;width:720px";
      for (let i = 0; i < 2000; i++) {
        const row = document.createElement("div");
        row.className = "flex items-start gap-2 px-3 py-1.5 text-ui leading-normal";
        const who = document.createElement("span");
        who.className = "font-medium text-ink";
        who.textContent = `agent-${i % 10}`;
        const body = document.createElement("p");
        body.className = "min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]";
        body.textContent = `M${i}: ${"words in a message ".repeat(3 + (i % 9))}`;
        row.append(who, body);
        host.append(row);
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
  });
}
