import { spawnSync } from "node:child_process";

type Step = { name?: string; if?: string; run?: string };

const DOC_TESTS: [name: string, command: string][] = [
  ["doc replay, a line you send from the composer shows once, whole, in a second window of yours too", "bun scripts/ui-doc-replay.ts --chromium --second-window --rounds=2"],
  ["doc send, sending at the bottom, scrolled up or a long line keeps the view where it was", "bun scripts/ui-send-scroll.ts"],
  ["doc follow, at the bottom the view follows an agent's lines, also right after you send while it posts and edits, in Chromium and WebKit", "bun scripts/ui-doc-follow.ts"],
  ["AFK meadow, the AFK scene draws and moves, follows the clock, rests while hidden, holds still for reduced motion and reuses its renderer, in WebKit", "bun scripts/ui-afk-meadow.ts"],
  [
    "AFK scene, a scene file runs in the app's frame, the default draws, a scene can't reach the network or the page, it hears the app's state and a broken one leaves the plain sky, in WebKit",
    "bun scripts/ui-afk-scene.ts",
  ],
  ["doc image order, a line sent with an image from the composer stays above the lines sent after it", "bun scripts/ui-doc-image-order.ts"],
  [
    "image copies, a Retina shot in the feed and the doc shows from a copy sized to its box, while the viewer, Save image and a drag get the original, in Chromium and WebKit",
    "bun scripts/ui-image-thumbs.ts || status=1\nbun scripts/ui-image-thumbs.ts --webkit || status=1",
  ],
  [
    "doc steady, tall lines sent below the fold keep their height when you scroll to them, in Chromium and WebKit",
    "bun scripts/ui-doc-steady.ts || status=1\nbun scripts/ui-doc-steady.ts --webkit || status=1",
  ],
  [
    "msg edit, an agent's edited message keeps its text on screen through every edit, in Chromium and WebKit",
    "bun scripts/ui-msg-edit.ts || status=1\nbun scripts/ui-msg-edit.ts --webkit || status=1",
  ],
  ["ui a busy thread doc never scrolls on its own, under the composer or while you read, in WebKit", "bun scripts/ui-doc-still.ts --dist ui/dist"],
  [
    "composer in a doc, late refusals keep the draft, PDFs, Edit in the composer, slow pasted images, the / menu and ⌘Enter, in Chromium and WebKit",
    'bun scripts/ui-composer-doc.ts &\nchromium=$!\nbun scripts/ui-composer-doc.ts --webkit &\nwebkit=$!\nstatus=0\nwait "$chromium" || status=1\nwait "$webkit" || status=1\nexit "$status"',
  ],
  ["edit an old message, ↑ on a long line from past the 400-message window opens it whole, and saving keeps it whole for everyone", "bun scripts/ui-edit-old.ts"],
];

const PARTS = ["send", "edit", "view"] as const;

const doc = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()) as {
  jobs: Record<string, { steps?: Step[]; strategy?: { matrix?: { part?: string[] } } }>;
};
const failures: string[] = [];
const check = (what: string, ok: boolean) => {
  if (!ok) failures.push(what);
};

const ciok = doc.jobs["ci-ok"]?.steps?.[0];
check("ci-ok exists with a first step", ciok !== undefined);
const fullRun = doc.jobs["ci-ok"]?.steps?.map((s) => s.run ?? "").join("\n") ?? "";
check("ci-ok requires plan success", /plan\.result \/\/ "absent from needs"/.test(fullRun) !== false && /\.plan\.result/.test(fullRun));
check("ci-ok iterates the plan's selected keys, not needs", /\$plan \| to_entries\[\] \| select\(\.value == true\)/.test(fullRun));
check("ci-ok rejects unselected successes", /ran but not selected/.test(fullRun));

function verdict(plan: string, needs: string): { code: number; out: string } {
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", ciok?.run ?? "exit 9"], {
    env: { ...process.env, NEEDS: needs, PLAN: plan },
  });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}`.trim() };
}

const job = (result: string) => ({ result });
const needs = (entries: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, job(v)])));
const FULLPLAN = JSON.stringify({
  static: true,
  "test-unit": true,
  "test-flows": true,
  build: true,
  doc: true,
  fuzz: true,
  shots: true,
  "desktop-mac": true,
  "desktop-linux": true,
  "desktop-distros": true,
  "cli-macos": true,
  ios: false,
  android: false,
});
const DOCPLAN = JSON.stringify({
  static: false,
  "test-unit": false,
  "test-flows": false,
  build: false,
  doc: true,
  fuzz: false,
  shots: false,
  "desktop-mac": false,
  "desktop-linux": false,
  "desktop-distros": false,
  "cli-macos": false,
  ios: false,
  android: false,
});

let v = verdict(
  FULLPLAN,
  needs({
    plan: "success",
    static: "success",
    "test-unit": "success",
    "test-flows": "success",
    build: "success",
    doc: "success",
    fuzz: "success",
    shots: "success",
    "desktop-mac": "success",
    "desktop-linux": "success",
    "desktop-distros": "success",
    "cli-macos": "success",
    ios: "skipped",
    android: "skipped",
  }),
);
check(`full green passes (${v.out})`, v.code === 0);
v = verdict(DOCPLAN, needs({ plan: "success", doc: "skipped" }));
check("selected doc skipped is rejected", v.code !== 0 && v.out.includes("doc: selected by plan, skipped"));
v = verdict(DOCPLAN, needs({ plan: "success", doc: "failure" }));
check("doc failure is rejected", v.code !== 0);
v = verdict(DOCPLAN, needs({ plan: "success", doc: "cancelled" }));
check("doc cancelled is rejected", v.code !== 0);
v = verdict(DOCPLAN, needs({ plan: "success", doc: "success", static: "skipped", "test-unit": "skipped", fuzz: "skipped" }));
check(`unselected skipped passes (${v.out})`, v.code === 0);
v = verdict(DOCPLAN, needs({ plan: "success" }));
check("selected doc absent from needs is rejected", v.code !== 0 && v.out.includes("absent from needs"));
v = verdict(DOCPLAN, needs({ plan: "failure" }));
check("failed plan is rejected", v.code !== 0);
v = verdict(DOCPLAN, needs({}));
check("plan absent from needs is rejected", v.code !== 0);
v = verdict("not json", needs({ plan: "success" }));
check("invalid plan selection is rejected", v.code !== 0);
v = verdict(DOCPLAN, needs({ plan: "success", doc: "success", fuzz: "success" }));
check("stray unselected success is rejected", v.code !== 0 && v.out.includes("fuzz: ran but not selected"));

const distrosPlan = JSON.stringify({
  static: false,
  "test-unit": false,
  "test-flows": false,
  build: false,
  doc: false,
  fuzz: false,
  shots: false,
  "desktop-mac": false,
  "desktop-linux": false,
  "desktop-distros": true,
  "cli-macos": false,
  ios: false,
  android: false,
});
v = verdict(distrosPlan, needs({ plan: "success", "desktop-distros": "skipped", "desktop-linux": "skipped" }));
check("dispatch naming distros without linux is rejected loudly", v.code !== 0 && v.out.includes("desktop-distros: selected by plan, skipped"));

const docJob = doc.jobs.doc;
const parts = docJob?.strategy?.matrix?.part ?? [];
check(`doc matrix parts are ${PARTS.join(",")}`, parts.length === PARTS.length && parts.every((p, i) => p === PARTS[i]));
const SETUP_STEPS = ["ui build", "ui harness build, with the plain-browser key store"];
const assignments = new Map<string, string>();
for (const step of docJob?.steps ?? []) {
  if (!step.name || SETUP_STEPS.includes(step.name)) continue;
  const known = DOC_TESTS.find(([name]) => name === step.name);
  check(`doc step "${step.name}" is in the inventory`, known !== undefined);
  if (!known || !step.run) continue;
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  check(`doc step "${step.name}" runs its inventory command unchanged`, flat(step.run).includes(flat(known[1])));
  const m = step.if?.match(/matrix\.part == '([a-z]+)'/);
  const part = m?.[1];
  check(`doc step "${step.name}" is on exactly one part`, part !== undefined && parts.includes(part));
  if (part !== undefined) {
    check(`doc step "${step.name}" is assigned once`, !assignments.has(step.name));
    assignments.set(step.name, part);
  }
}
check(
  "every inventory test is on a leg",
  DOC_TESTS.every(([name]) => assignments.has(name)),
);
const perPart = new Map<string, number>();
for (const part of assignments.values()) perPart.set(part, (perPart.get(part) ?? 0) + 1);
check(
  `all three legs carry tests (${[...perPart.entries()].map(([p, n]) => `${p}:${n}`).join(" ")})`,
  parts.every((p) => (perPart.get(p) ?? 0) > 0),
);

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL: ${f}`).join("\n"));
  process.exit(1);
}
console.log(`ci-ok contract holds and the doc inventory is whole: ${DOC_TESTS.length} tests, one leg each (${[...perPart.entries()].map(([p, n]) => `${p} ${n}`).join(", ")})`);
