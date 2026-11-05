import { expect, test } from "bun:test"

import { readPrefs } from "~/live/prefs"

const storeOf = (saved: Record<string, string>) => {
  const m = new Map(Object.entries(saved))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

test("a saved Channels Dark moves to OLED Black once, and a later pick of it stays", () => {
  const store = storeOf({ "ui.prefs": JSON.stringify({ enterSends: false, darkTheme: "channels-dark", lightTheme: "channels-light" }) })
  expect(readPrefs(store)).toMatchObject({ enterSends: false, darkTheme: "channels-oled" })
  expect(JSON.parse(store.m.get("ui.prefs") ?? "{}")).toMatchObject({ enterSends: false, darkTheme: "channels-oled" })
  store.setItem("ui.prefs", JSON.stringify({ enterSends: false, darkTheme: "channels-dark", lightTheme: "channels-light" }))
  expect(readPrefs(store).darkTheme).toBe("channels-dark")
})

test("every other saved theme stays, and a new install starts on OLED Black without saving prefs", () => {
  const picked = storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "abyssal-trench" }) })
  expect(readPrefs(picked).darkTheme).toBe("abyssal-trench")
  expect(picked.m.get("ui.prefs")).toBe(JSON.stringify({ darkTheme: "abyssal-trench" }))
  const fresh = storeOf({})
  expect(readPrefs(fresh).darkTheme).toBe("channels-oled")
  expect(fresh.m.has("ui.prefs")).toBe(false)
  expect(fresh.m.get("ui.prefs.oled")).toBe("1")
})

test("Calm waits 3 minutes unless a kept choice says otherwise, and only takes Off, 1, 3, 5 or 10", () => {
  expect(readPrefs(storeOf({})).calm).toBe(3)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 0 }) })).calm).toBe(0)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 10 }) })).calm).toBe(10)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 7 }) })).calm).toBe(3)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: "5" }) })).calm).toBe(3)
})
