import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { GithubRepoView } from "@/lib/secrets"
import type { Reach } from "./repos"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { ReposView } = await import("./repos")

const repo = (fullName: string, priv = false): GithubRepoView => ({ fullName, private: priv, pushedAt: 1_760_000_000_000 })
const linked: Reach = { kind: "repos", list: [repo("kiwi-init/channels"), repo("ojowwalker77/kiwi-site", true), repo("octo/hello")] }
const save = async () => undefined
const html = (props: { repos: string[]; reach: Reach; onSave?: (r: string[]) => Promise<void>; initialQuery?: string }) => renderToStaticMarkup(createElement(ReposView, props))

describe("connecting a channel to repos", () => {
  test("lists the repos the linked account reaches, the ones already in the channel marked chosen", () => {
    const out = html({ repos: ["kiwi-init/channels"], reach: linked, onSave: save })
    expect(out).toContain("ojowwalker77/kiwi-site")
    expect(out).toContain("octo/hello")
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(out).toContain('aria-label="Remove kiwi-init/channels"')
  })

  test("the search narrows the list to what matches", () => {
    const out = html({ repos: [], reach: linked, onSave: save, initialQuery: "site" })
    expect(out).toContain("ojowwalker77/kiwi-site")
    expect(out).not.toContain("octo/hello")
    expect(out).not.toContain("kiwi-init/channels")
  })

  test("a typed owner/repo the account doesn't list can still be added, a pasted GitHub link too", () => {
    expect(html({ repos: [], reach: linked, onSave: save, initialQuery: "someone/else" })).toContain("someone/else")
    expect(html({ repos: [], reach: { kind: "none", why: "Link GitHub in Settings to pick from your repos." }, onSave: save, initialQuery: "https://github.com/a/b.git" })).toContain(">a/b</span>")
  })

  test("without a linked account it says how to get the picker; without owner rights it only lists", () => {
    expect(html({ repos: [], reach: { kind: "none", why: "Link GitHub in Settings to pick from your repos." }, onSave: save })).toContain("Link GitHub in Settings")
    const member = html({ repos: ["octo/hello"], reach: linked })
    expect(member).toContain("octo/hello")
    expect(member).not.toContain("Find a repo")
    expect(member).not.toContain("Remove octo/hello")
  })
})
