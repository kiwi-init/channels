import { completeMention, matchPeople, mentionQuery, recipients, type Person } from "./mentions"

const people: Person[] = [
  { name: "kiwi-sh", label: "Coordinator", agent: true },
  { name: "kiwi-browser", label: "Browser", agent: true },
  { name: "merge-bus", label: "Merge bus", agent: true },
  { name: "jow", label: "Jow", agent: false },
]

describe("mentionQuery", () => {
  it("is the word after an @ that the caret ends, at the start or after a space", () => {
    expect(mentionQuery("@ki", 3)).toBe("ki")
    expect(mentionQuery("hi @ki", 6)).toBe("ki")
    expect(mentionQuery("hi @", 4)).toBe("")
  })

  it("is nothing inside a word, after a space, or before the caret", () => {
    expect(mentionQuery("mail me@ki", 10)).toBeNull()
    expect(mentionQuery("hi @ki there", 12)).toBeNull()
    expect(mentionQuery("hi @ki", 3)).toBeNull()
    expect(mentionQuery("no mention", 10)).toBeNull()
  })
})

describe("matchPeople", () => {
  it("matches a name or a label by its start, ignoring case, and caps the list", () => {
    expect(matchPeople(people, "KI").map((p) => p.name)).toEqual(["kiwi-sh", "kiwi-browser"])
    expect(matchPeople(people, "merge").map((p) => p.name)).toEqual(["merge-bus"])
    expect(matchPeople(people, "cOORD").map((p) => p.name)).toEqual(["kiwi-sh"])
    expect(matchPeople(people, "", 2)).toHaveLength(2)
    expect(matchPeople(people, "zzz")).toEqual([])
  })
})

describe("completeMention", () => {
  it("writes the full name and a space, and says where the caret goes", () => {
    expect(completeMention("hi @ki", 6, people[0]!)).toEqual({ text: "hi @kiwi-sh ", caret: 12 })
    expect(completeMention("@m and more", 2, people[2]!)).toEqual({ text: "@merge-bus  and more", caret: 11 })
  })
})

describe("recipients", () => {
  const names = new Set(people.map((p) => p.name))

  it("is who the message starts by naming", () => {
    expect(recipients("@kiwi-sh @jow please look", names)).toEqual(["kiwi-sh", "jow"])
    expect(recipients("@kiwi-sh, @merge-bus: ship it", names)).toEqual(["kiwi-sh", "merge-bus"])
  })

  it("leaves out names that are not here and mentions in the middle of the text", () => {
    expect(recipients("@nobody hi", names)).toEqual([])
    expect(recipients("thanks @kiwi-sh", names)).toEqual([])
  })
})
