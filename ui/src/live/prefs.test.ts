import { expect, test } from "bun:test"

import { readPrefs } from "~/live/prefs"

const storeOf = (saved: Record<string, string>) => {
  const m = new Map(Object.entries(saved))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

test("a saved OLED Black moves to Cinder Peak once, and a later pick of it stays", () => {
  const store = storeOf({ "ui.prefs": JSON.stringify({ enterSends: false, darkTheme: "channels-oled", lightTheme: "channels-light" }), "ui.prefs.oled": "1" })
  expect(readPrefs(store)).toMatchObject({ enterSends: false, darkTheme: "cinder-peak" })
  expect(JSON.parse(store.m.get("ui.prefs") ?? "{}")).toMatchObject({ enterSends: false, darkTheme: "cinder-peak" })
  expect(store.m.get("ui.prefs.cinder")).toBe("1")
  store.setItem("ui.prefs", JSON.stringify({ enterSends: false, darkTheme: "channels-oled", lightTheme: "channels-light" }))
  expect(readPrefs(store).darkTheme).toBe("channels-oled")
})

test("a Channels Dark that never moved to OLED Black lands on Cinder Peak; one picked after that move stays", () => {
  const never = storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "channels-dark" }) })
  expect(readPrefs(never).darkTheme).toBe("cinder-peak")
  expect(readPrefs(never).darkTheme).toBe("cinder-peak")
  const picked = storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "channels-dark" }), "ui.prefs.oled": "1" })
  expect(readPrefs(picked).darkTheme).toBe("channels-dark")
})

test("every other saved theme stays, and a new install starts on Cinder Peak without saving prefs", () => {
  const picked = storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "abyssal-trench" }) })
  expect(readPrefs(picked).darkTheme).toBe("abyssal-trench")
  expect(picked.m.get("ui.prefs")).toBe(JSON.stringify({ darkTheme: "abyssal-trench" }))
  const fresh = storeOf({})
  expect(readPrefs(fresh).darkTheme).toBe("cinder-peak")
  expect(fresh.m.has("ui.prefs")).toBe(false)
  expect([fresh.m.get("ui.prefs.oled"), fresh.m.get("ui.prefs.cinder")]).toEqual(["1", "1"])
})

test("AFK waits 3 minutes unless a kept choice says otherwise, and only takes Off, 1, 3, 5 or 10", () => {
  expect(readPrefs(storeOf({})).afk).toBe(3)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ afk: 0 }) })).afk).toBe(0)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ afk: 10 }) })).afk).toBe(10)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ afk: 7 }) })).afk).toBe(3)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ afk: "5" }) })).afk).toBe(3)
})

test("a Calm choice saved before the rename comes back as the AFK choice", () => {
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 0 }) })).afk).toBe(0)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 10 }) })).afk).toBe(10)
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ calm: 10, afk: 1 }) })).afk).toBe(1)
})
