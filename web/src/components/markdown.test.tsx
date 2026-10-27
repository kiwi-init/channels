import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Markdown } from "./markdown"
import { MentionNames } from "../lib/mentions"
import { errorLine } from "./mermaid"
import { compareCells, mentionParts, messageRefs, nextSort, sanitizeMarkdownUrl } from "../lib/markdown"

describe("mentions", () => {
  const nicks: Record<string, string> = { "jovial-gecko": "claude", "zesty-owl": "grokbot", jow: "Jow" }
  const labelOf = (name: string) => nicks[name]
  const render = (body: string) => renderToStaticMarkup(createElement(MentionNames.Provider, { value: labelOf }, createElement(Markdown, null, body)))

  test("@handle of a member becomes their nickname, keeping the handle; trailing punctuation stays text", () => {
    expect(mentionParts("ask @jovial-gecko, then @zesty-owl.", labelOf)).toEqual([
      { kind: "text", text: "ask " },
      { kind: "mention", text: "@jovial-gecko", name: "jovial-gecko", label: "claude" },
      { kind: "text", text: ", then " },
      { kind: "mention", text: "@zesty-owl", name: "zesty-owl", label: "grokbot" },
      { kind: "text", text: "." },
    ])
  })

  test("leaves emails, unknown names, @all and lone @ alone", () => {
    for (const text of ["mail jow@example.com", "@nobody here", "@all", "a @ b", "x/@jow"]) {
      expect(mentionParts(text, labelOf)).toEqual([{ kind: "text", text }])
    }
  })

  test("rendered mentions read as the nickname with the @handle on hover, but not inside code or links", () => {
    const html = render("@jovial-gecko look\n\n`@jow` and [@zesty-owl](https://example.com)")
    expect(html).toContain('<span title="@jovial-gecko" class="font-medium text-link">@claude</span>')
    expect(html).toContain("<code")
    expect(html).toContain("@jow</code>")
    expect(html).not.toContain(">@grokbot<")
    expect(html).not.toContain(">@Jow<")
  })

  test("a bare handle in prose reads as the nickname too, matched as a whole word", () => {
    expect(mentionParts("jovial-gecko continues; jow and zesty-owl.", labelOf)).toEqual([
      { kind: "handle", text: "jovial-gecko", name: "jovial-gecko", label: "claude" },
      { kind: "text", text: " continues; jow and " },
      { kind: "handle", text: "zesty-owl", name: "zesty-owl", label: "grokbot" },
      { kind: "text", text: "." },
    ])
    for (const text of ["jovial-geckos", "jovial-gecko@example.com", "x/jovial-gecko", "a.jovial-gecko", "jow said so"]) {
      expect(mentionParts(text, labelOf)).toEqual([{ kind: "text", text }])
    }
  })

  test("a rendered bare handle shows the nickname with the handle on hover, while code keeps the handle", () => {
    const html = render("jovial-gecko said `kiwi task review T2 --review zesty-owl`\n\n```\njovial-gecko\n```")
    expect(html).toContain('<span title="jovial-gecko" class="font-medium text-link">claude</span> said')
    expect(html).toContain("--review zesty-owl</code>")
    expect(html).toContain("jovial-gecko\n</code>")
    expect(html).not.toContain(">grokbot<")
  })

  test("without names (outside a conversation) a mention stays the @handle as written", () => {
    expect(renderToStaticMarkup(createElement(Markdown, null, "@jovial-gecko look"))).toBe(
      '<div class="[overflow-wrap:anywhere] break-words"><p class="[&amp;:not(:first-child)]:mt-2">@jovial-gecko look</p></div>'
    )
  })

  test("mentions and #N references share a line", () => {
    const html = renderToStaticMarkup(createElement(MentionNames.Provider, { value: labelOf }, createElement(Markdown, { refs: { known: (seq: number) => seq === 5, open: () => {} } }, "@jow see #5")))
    expect(html).toContain(">@Jow</span> see <button")
    expect(html).toContain(">#5</button>")
  })
})

describe("message references", () => {
  const known = (seq: number) => seq < 1000

  test("#N becomes a reference to message N when the channel has it", () => {
    expect(messageRefs("see #305 and #315.", known)).toEqual([
      { kind: "text", text: "see " },
      { kind: "ref", text: "#305", seq: 305 },
      { kind: "text", text: " and " },
      { kind: "ref", text: "#315", seq: 315 },
      { kind: "text", text: "." },
    ])
  })

  test("leaves anchors, words, zero and unknown messages alone", () => {
    for (const text of ["page#3", "a/b/#4", "&#123;", "#0", "#12abc", "##5", "#4000", "café#3", "#12é"]) {
      expect(messageRefs(text, known)).toEqual([{ kind: "text", text }])
    }
  })

  test("rendered refs are buttons, but not inside code or existing links", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { refs: { known, open: () => {} } }, "Drafted in #315.\n\n`#316` and [#317](https://example.com)"))
    expect(html).toContain('<button type="button" data-ref="" class="text-link')
    expect(html).toContain(">#315</button>")
    expect(html).not.toContain(">#316</button>")
    expect(html).not.toContain(">#317</button>")
    expect(html).not.toContain("value=")
  })

  test("a table header keeps #N as text inside its sort button, and body cells link it", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { refs: { known, open: () => {} } }, "| #3 |\n| --- |\n| #4 |"))
    expect(html).not.toContain(">#3</button>")
    expect(html).toContain(">#4</button>")
  })

  test("without refs, #N stays text", () => {
    expect(renderToStaticMarkup(createElement(Markdown, null, "Drafted in #315."))).not.toContain("<button")
  })
})

describe("safe markdown links", () => {
  test("allows http, https, mailto and tel only", () => {
    expect(sanitizeMarkdownUrl("https://example.com/a")).toBe("https://example.com/a")
    expect(sanitizeMarkdownUrl("http://example.com")).toBe("http://example.com")
    expect(sanitizeMarkdownUrl("mailto:a@b.example")).toBe("mailto:a@b.example")
    expect(sanitizeMarkdownUrl("tel:+15551212")).toBe("tel:+15551212")
  })

  test("rejects scripts, data, files, relative paths and userinfo", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/channel/facts/ip",
      "//evil.example",
      "https://user:pass@evil.example",
      "https://evil.example/a b",
      "java\nscript:alert(1)",
      "https://evil.example/\t.good.com",
    ]) {
      expect(sanitizeMarkdownUrl(url)).toBeUndefined()
    }
  })

  test("rendered links drop unsafe schemes and do not fetch images", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, null, "[ok](https://example.com)\n[bad](javascript:alert(1))\n[mail](mailto:a@b.example)\n![pic](https://evil.example/x.png)\n![nope](javascript:alert(1))")
    )
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('href="mailto:a@b.example"')
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("<img")
    expect(html).toContain("opens evil.example")
  })
})

describe("markdown tables and code", () => {
  test("sort cycles and compares numbers as numbers", () => {
    expect(nextSort(null, 1)).toEqual({ column: 1, direction: "asc" })
    expect(nextSort({ column: 1, direction: "asc" }, 1)).toEqual({ column: 1, direction: "desc" })
    expect(nextSort({ column: 1, direction: "desc" }, 1)).toBeNull()
    expect(compareCells("10", "2")).toBeGreaterThan(0)
    expect(compareCells("a", "B")).toBeLessThan(0)
  })

  test("a fenced block offers copy and a table header can be sorted", () => {
    const html = renderToStaticMarkup(createElement(Markdown, null, "```js\nconsole.log(1)\n```\n\n| n | name |\n| - | - |\n| 10 | b |\n| 2 | a |\n"))
    expect(html).toContain('aria-label="Copy code"')
    expect(html).toContain("console.log(1)")
    expect(html).toContain('aria-label="Sort by n"')
    expect(html).toContain('aria-sort="none"')
    expect(html).not.toContain("<script")
  })
})

describe("copying code", () => {
  test("a long inline command is a copy button, a short one stays plain code", () => {
    const html = renderToStaticMarkup(createElement(Markdown, null, "run `kiwi -c channels-dev --as bus listen --now` or `ls`"))
    expect(html).toContain('aria-label="Copy kiwi -c channels-dev --as bus listen --now"')
    expect(html).not.toContain('aria-label="Copy ls"')
    expect(html).toContain("<code")
  })

  test("a fenced block's Copy button is shown on touch screens too", () => {
    const html = renderToStaticMarkup(createElement(Markdown, null, "```sh\nkiwi status\n```"))
    expect(html).toContain('aria-label="Copy code"')
    expect(html).toContain("[@media(hover:none)]:opacity-100")
  })
})

describe("mermaid blocks", () => {
  const fence = "```"
  test("a mermaid block shows its code until the diagram is drawn, and other code stays a plain block", () => {
    const html = renderToStaticMarkup(createElement(Markdown, null, `${fence}mermaid\nflowchart LR\n  A --> B\n${fence}\n\n${fence}ts\nconst a = 1\n${fence}`))
    expect(html.match(/group\/mermaid/g)?.length).toBe(1)
    expect(html).toContain("A --&gt; B")
    expect(html).toContain("const a = 1")
    expect(html).not.toContain('aria-label="Mermaid diagram"')
  })

  test("an empty mermaid block is ordinary code", () => {
    expect(renderToStaticMarkup(createElement(Markdown, null, `${fence}mermaid\n${fence}`))).not.toContain("group/mermaid")
  })

  test("a parse error is shown as its first line, without the trailing colon", () => {
    expect(errorLine(new Error("Parse error on line 2:\n...A[relay --> B{{daemon\n-----^\nExpecting 'SQE'"))).toBe("Parse error on line 2")
    expect(errorLine(new Error(""))).toBe("it isn’t valid Mermaid")
    expect(errorLine("No diagram type detected")).toBe("No diagram type detected")
  })
})
