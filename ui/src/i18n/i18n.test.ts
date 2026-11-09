import { describe, expect, test } from "bun:test"

import { en, type Key, type Msg } from "~/i18n/en"
import { CATALOGS, langOf, LANGS, t, type Catalog } from "~/i18n/i18n"

const holes = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
const forms = (msg: Msg): string[] => (typeof msg === "string" ? [msg] : Object.values(msg))

describe("every catalog says everything English says (spec #759)", () => {
  for (const [lang, load] of Object.entries(CATALOGS)) {
    test(`${lang}: the same keys, the same {holes}, and only plural forms ${lang} has`, async () => {
      const catalog: Catalog = (await load()).default
      const keys = Object.keys(en) as Key[]
      expect(keys.filter((k) => catalog[k] === undefined)).toEqual([])
      expect(Object.keys(catalog).filter((k) => !(k in en))).toEqual([])
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[]
      for (const key of keys) {
        const msg = catalog[key]!
        const source = en[key]
        const want = holes(typeof source === "string" ? source : source.other)
        for (const text of forms(msg)) expect({ key, holes: holes(text) }).toEqual({ key, holes: want })
        if (typeof msg !== "string") {
          expect({ key, other: typeof msg.other }).toEqual({ key, other: "string" })
          expect({ key, extra: Object.keys(msg).filter((c) => !categories.includes(c)) }).toEqual({ key, extra: [] })
        }
      }
    })
  }
})

describe("the language follows the system's first one Channels speaks", () => {
  test("regional tags fold into the five, and anything else is English", () => {
    expect(langOf(["pt-PT"])).toBe("pt-BR")
    expect(langOf(["fr-FR", "ja-JP", "en"])).toBe("ja")
    expect(langOf(["ko-KR"])).toBe("ko")
    expect(langOf(["zh-Hans-CN"])).toBe("zh-CN")
    expect(langOf(["en-GB", "pt-BR"])).toBe("en")
    expect(langOf(["fr", "de"])).toBe("en")
    expect(langOf([])).toBe("en")
    expect([...LANGS]).toEqual(["en", "pt-BR", "ja", "ko", "zh-CN"])
  })
})

describe("t() fills holes, picks the plural form and formats numbers", () => {
  test("English, before any other catalog loads", () => {
    expect(t("usage.used.of", { used: 4120, limit: 100_000 })).toBe("4,120 of 100,000")
    expect(t("usage.per.day", { count: 1 })).toBe("1 message a day.")
    expect(t("usage.per.day", { count: 1000 })).toBe("1,000 messages a day.")
    expect(t("usage.channel.out.sub", { who: "maya", again: "Soon." })).toBe("maya has used today's messages, so nobody can send here for now. Soon.")
    expect(t("usage.hint", {})).toBe("In the channels you own, agents' included. Resets in {time}.")
  })
})
