import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const MOVED: { what: string; markers: string[] }[] = [
  {
    what: "live/actions-later.ts, the actions behind settings, tasks, specs, members, rooms, devices and GitHub",
    markers: ["live.actions.role.not.changed", "live.actions.task.not.added", "live.actions.device.forget.failed", "live.actions.enroll.failed"],
  },
  { what: "live/computer-later.ts, the settings half of live/computer.ts", markers: ["live.computer.hook.line", "live.computer.desktop.only"] },
  { what: "the words of the later actions, in en/live-later.ts", markers: ["Role not changed", "Couldn't forget the device", "this needs the Channels desktop app"] },
  { what: "the attachment and suggestion words, in en/chat-later.ts", markers: ["is empty or too big to send", "couldn't be read"] },
  { what: "the usage words, in en/usage.ts", markers: ["has used today's messages, so nobody can send here for now", "The paid plan's fair-use limit, agents' included"] },
  { what: "the narrow panel's words, in en/shell-later.ts", markers: ["Resize the panel"] },
];

const html = readFileSync(join(dist, "index.html"), "utf8");
const firstFiles = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"|<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, a, b]) => a ?? b ?? "");
const firstLoad = firstFiles.map((f) => readFileSync(join(dist, f), "utf8")).join("\n");
const laterFiles = readdirSync(join(dist, "assets"))
  .filter((f) => f.endsWith(".js") && !firstFiles.includes(`assets/${f}`) && !/^(pt-BR|ja|ko|zh-CN)-/.test(f))
  .map((f) => ({ f, text: readFileSync(join(dist, "assets", f), "utf8") }));

const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

expect(firstFiles.length > 1, `read the first load from index.html: the entry plus ${firstFiles.length - 1} preloaded files`);
const deferred = new Set<string>();
for (const { what, markers } of MOVED) {
  const out = markers.filter((m) => firstLoad.includes(m));
  const homes = markers.map((m) => laterFiles.find((l) => l.text.includes(m))?.f);
  for (const f of homes) if (f) deferred.add(f);
  expect(out.length === 0, `${what}: out of the first load${out.length ? ` (still there: ${out.join(", ")})` : ""}`);
  expect(homes.every(Boolean), `${what}: in a chunk that loads later${homes.some((h) => !h) ? ` (nowhere: ${markers.filter((_, i) => !homes[i]).join(", ")})` : ""}`);
}

for (const f of [...deferred].sort()) console.log(`deferred, not counted in the first load: ${readFileSync(join(dist, "assets", f)).length} bytes  assets/${f}`);
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
