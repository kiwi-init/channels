import { describe, expect, test } from "bun:test"
import { repoOffers } from "~/panels/repo-offers"

describe("Add a repo offers your GitHub repos (T429)", () => {
  test("in GitHub's order, leaving out the channel's own, whatever their case", () => {
    expect(repoOffers(["kiwi-init/landing", "kiwi-init/channels", "me/dotfiles"], ["Kiwi-Init/Channels"])).toEqual(["kiwi-init/landing", "me/dotfiles"])
  })

  test("nothing to offer when GitHub isn't linked", () => {
    expect(repoOffers([], ["kiwi-init/channels"])).toEqual([])
  })
})
