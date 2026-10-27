import type { Channel, Image, Message, PullRequest, Reaction } from "~/model"

const COUNT = 1500
const general = { kind: "room", room: "general" } as const
const HUMANS = ["jow", "maya"]
const AGENTS = ["atlas", "win", "pixel", "ridge"]
const TASKS = [9, 10, 11, 12, 13, 14, 15]
const EMOJI = ["👍", "🔥", "👀", "✅", "🎉"]

const CHAT = [
  "morning! anything blocking the release?",
  "nice, thanks!",
  "looks good to me",
  "ship it",
  "lol",
  "👍",
  "hmm, the sidebar flickers when I switch channels",
  "is the relay down? my phone says offline",
  "can someone check why CI is red on main?",
  "can we skip the Linux check for now? it's fine on my box",
  "I tried the new build on my Arch box and scrolling feels great, but the composer jumps when I paste an image. Can we look at that after the release?",
  "the new icons are so much better",
  "wait, which branch is this on?",
  "ok merging after lunch",
  "does this help the phone app too?",
  "I'd keep the setting, people asked for it twice",
  "can you post a shot of the light theme too?",
  "back in 20",
  "that was fast",
  "please don't touch the release branch today",
]

const STATUS = [
  "On it.",
  "Picked up T{t}. Measuring first.",
  "Opened T{t} for it. I'll take it after the bundle work lands.",
  "Done with T{t}: PR #{pr} is up.",
  "CI is green on #{pr}, merging.",
  "Merged #{pr}. Moving to the next one.",
  "`bun test` passes locally; pushing.",
  "Rebased on main, two conflicts in `ui/src/chat/conversation.tsx`, both trivial.",
  "Blocked on a review for #{pr}. @atlas can you take a look?",
  "The flaky test was a timer in `relay.test.ts`, fixed in #{pr}.",
  "Linux build is green on GNOME, KDE and sway.",
  "Shots are on the PR. Waiting for your OK before merging.",
  "Bundle is down **{n} KB** so far. `mermaid` was riding in on `markdown.ts`; it now loads with the first diagram.",
  "~~two copies~~ three copies of `effect`, actually. Fixing.",
]

const REPLIES = [
  "Yes. I'll run it once at the end instead of after each step.",
  "Agreed, leaving it.",
  "Good catch, fixing now.",
  "That's on purpose: the relay retries on its own.",
  "Not yet, it lands with #{pr}.",
  "Can do. Give me ten minutes.",
  "I checked: it only happens on the first launch.",
  "+1",
]

const TITLES = [
  "Fold duplicate event rows",
  "Shrink the first-load bundle",
  "Polish the conversation feed",
  "Add a dark mode toggle",
  "Redraw the channel icons",
  "Rotate the relay's signing key",
  "Keep the composer above the keyboard",
  "Retry sends after a relay restart",
  "Show who's typing in threads",
  "Cache avatars between launches",
]

function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function report(n: number, pick: <T>(list: readonly T[]) => T, int: (lo: number, hi: number) => number): string {
  const kinds = [
    () =>
      [
        `## Where T${pick(TASKS)} stands`,
        "",
        "What moved, measured with `scripts/web-bundle.ts`:",
        "",
        "| Chunk | Before | Now |",
        "| --- | ---: | ---: |",
        `| app | ${int(380, 460)} KB | ${int(280, 379)} KB |`,
        `| icons | ${int(20, 40)} KB | ${int(4, 12)} KB |`,
        "| markdown | 88 KB | lazy |",
        "",
        "### Next",
        "",
        "1. Drop the second copy of `effect` that rides in with the relay client",
        "2. Inline the icon sprite (3 KB, @win says keep it)",
        "3. Check the Linux build after each step",
        "",
        "Numbers come from CI's queue run, not my Mac, so they're stable.",
      ].join("\n"),
    () =>
      [
        `Review of #${int(900, 1100)}:`,
        "",
        "- [x] Types and lint are clean",
        "- [x] The new test fails without the fix",
        "- [ ] The Linux shot still shows the old frost",
        "",
        "> Don't lazy-split shared modules: it grew the first load last time.",
        "",
        "One change before merging:",
        "",
        "```ts",
        `const size = await bundle("web")`,
        `if (size.first > ${int(250, 320)}_000) throw new Error(\`first load is \${size.first} bytes\`)`,
        "console.log(`ok: ${(size.first / 1024).toFixed(1)} KB`)",
        "```",
      ].join("\n"),
    () =>
      [
        `### Relay incident, ${int(1, 28)} Oct`,
        "",
        `The relay dropped sockets for **${int(2, 9)} minutes** after the deploy. What happened:`,
        "",
        "1. The new worker started before the old one drained",
        "2. Clients reconnected all at once and hit the rate limit",
        "3. The retry backoff reset on every failure, so they kept hitting it",
        "",
        "Fixed in two places:",
        "",
        "```diff",
        "- const wait = 250",
        "+ const wait = Math.min(30_000, 250 * 2 ** attempt) * (0.5 + Math.random())",
        "```",
        "",
        "| Metric | Before | After |",
        "| --- | ---: | ---: |",
        `| reconnects / min | ${int(800, 2000)} | ${int(20, 90)} |`,
        `| p95 send | ${int(400, 900)} ms | ${int(60, 140)} ms |`,
      ].join("\n"),
    () =>
      [
        `Plan for T${pick(TASKS)}, step ${n % 7}:`,
        "",
        "- Move the scroll anchor out of the scroll handler",
        "- Keep rows that didn't change from rendering again",
        "- Measure in WebKit, not Chromium: it's the engine people see",
        "  - macOS: WKWebView",
        "  - Linux: WebKitGTK",
        "",
        `I'll post numbers in about ${int(10, 50)} minutes.`,
      ].join("\n"),
  ]
  return pick(kinds)()
}

function shot(n: number, hue: number): Image {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">`,
    `<rect width="1200" height="750" fill="hsl(${hue} 18% 12%)"/>`,
    `<rect x="0" y="0" width="260" height="750" fill="hsl(${hue} 14% 16%)"/>`,
    ...Array.from({ length: 9 }, (_, i) => `<rect x="300" y="${60 + i * 72}" width="${420 + ((i * 97 + n) % 420)}" height="18" rx="9" fill="hsl(${hue} 10% ${30 + (i % 3) * 8}%)"/>`),
    `<rect x="300" y="660" width="860" height="56" rx="16" fill="hsl(${hue} 14% 20%)"/>`,
    `</svg>`,
  ].join("")
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: 1200, height: 750, alt: `Shot ${n} of the new feed` }
}

export function longFeed(base: Channel): Channel {
  const r = random(1045)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
  const fill = (text: string): string =>
    text
      .replace(/\{t\}/g, () => String(pick(TASKS)))
      .replace(/\{pr\}/g, () => String(int(900, 1100)))
      .replace(/\{n\}/g, () => String(int(8, 60)))
  const pr = (): PullRequest => {
    const number = int(900, 1100)
    const state = pick(["open", "open", "merged", "merged", "closed", "draft"] as const)
    return {
      repo: "kiwi-init/channels",
      number,
      title: pick(TITLES),
      url: `https://github.com/kiwi-init/channels/pull/${number}`,
      state,
      checks: pick(["pass", "pass", "fail", "running", "none"] as const),
      additions: int(4, 600),
      deletions: int(0, 300),
    }
  }
  const reactions = (): Reaction[] | undefined => {
    if (r() > 0.12) return undefined
    const emoji = [...new Set([pick(EMOJI), pick(EMOJI)])]
    return emoji.map((e) => ({ emoji: e, by: [...new Set([pick(HUMANS), pick([...HUMANS, ...AGENTS])])] }))
  }

  const out: Message[] = []
  const latest = (base.messages.find((m) => m.where.kind === "room" && m.where.room === "general")?.at ?? Date.now()) - 60 * 60_000
  let at = latest - COUNT * 9 * 60_000
  let from = pick(HUMANS)
  for (let i = 0; i < COUNT; i++) {
    const seq = 2000 + i
    at += r() < 0.06 ? int(60, 600) * 60_000 : int(5, 400) * 1000
    at = Math.min(at, latest - (COUNT - i) * 1000)
    if (r() > 0.45) from = r() < 0.4 ? pick(HUMANS) : pick(AGENTS)
    const agent = AGENTS.includes(from)
    const roll = r()
    const earlier = out.slice(-32).filter((m) => !m.system)
    const target = earlier.length > 2 ? earlier[Math.floor(r() * (earlier.length - 2))] : undefined
    if (roll < 0.03) {
      out.push({ seq, from: pick(AGENTS), at, text: `${pick(AGENTS)} moved T${pick(TASKS)} to ${pick(["review", "doing", "done", "waiting"])}`, where: general, system: true })
      continue
    }
    const msg: Message = { seq, from, at, text: "", where: general }
    if (agent && roll < 0.2) out.push({ ...msg, text: report(i, pick, int), task: r() < 0.5 ? pick(TASKS) : undefined, reactions: reactions() })
    else if (roll < 0.33 && target) out.push({ ...msg, text: fill(pick(REPLIES)), replyTo: target.seq })
    else if (roll < 0.38) out.push({ ...msg, text: `@jow ${fill(pick(agent ? STATUS : CHAT))}`, mentionsYou: true })
    else if (roll < 0.39) out.push({ ...msg, text: pick(["New feed, dark theme:", "Here's the Linux shot:", "Before and after:"]), images: [shot(i, int(180, 260))] })
    else if (agent) {
      const text = fill(pick(STATUS))
      out.push({ ...msg, text, task: r() < 0.35 ? pick(TASKS) : undefined, pr: text.includes("PR #") || r() < 0.1 ? pr() : undefined, reactions: reactions() })
    } else out.push({ ...msg, text: fill(pick(CHAT)), reactions: reactions() })
  }

  return { ...base, messages: [...out, ...base.messages] }
}
