import { expect, test } from "bun:test"

import { readPrefs } from "~/live/prefs"

const storeOf = (saved: Record<string, string>) => {
  const m = new Map(Object.entries(saved))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

test("the old default Cinder Peak moves to Channels Dark once, and a later pick of Cinder Peak stays", () => {
  const store = storeOf({ "ui.prefs": JSON.stringify({ enterSends: false, darkTheme: "cinder-peak", lightTheme: "channels-light" }), "ui.prefs.oled": "1", "ui.prefs.cinder": "1" })
  expect(readPrefs(store)).toMatchObject({ enterSends: false, darkTheme: "channels-dark" })
  expect(JSON.parse(store.m.get("ui.prefs") ?? "{}")).toMatchObject({ enterSends: false, darkTheme: "channels-dark" })
  expect(store.m.get("ui.prefs.channels-dark")).toBe("1")
  store.setItem("ui.prefs", JSON.stringify({ enterSends: false, darkTheme: "cinder-peak", lightTheme: "channels-light" }))
  expect(readPrefs(store).darkTheme).toBe("cinder-peak")
})

test("a saved OLED Black or an old Channels Dark from before the earlier moves lands on Channels Dark; OLED picked since stays", () => {
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "channels-oled" }), "ui.prefs.oled": "1" })).darkTheme).toBe("channels-dark")
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "channels-dark" }) })).darkTheme).toBe("channels-dark")
  const all = { "ui.prefs.oled": "1", "ui.prefs.cinder": "1", "ui.prefs.channels-dark": "1" }
  expect(readPrefs(storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "channels-oled" }), ...all })).darkTheme).toBe("channels-oled")
})

test("every other saved theme stays, and a new install starts on Channels Dark without saving prefs", () => {
  const picked = storeOf({ "ui.prefs": JSON.stringify({ darkTheme: "abyssal-trench" }) })
  expect(readPrefs(picked).darkTheme).toBe("abyssal-trench")
  expect(picked.m.get("ui.prefs")).toBe(JSON.stringify({ darkTheme: "abyssal-trench" }))
  const fresh = storeOf({})
  expect(readPrefs(fresh).darkTheme).toBe("channels-dark")
  expect(fresh.m.has("ui.prefs")).toBe(false)
  expect([fresh.m.get("ui.prefs.oled"), fresh.m.get("ui.prefs.cinder"), fresh.m.get("ui.prefs.channels-dark")]).toEqual(["1", "1", "1"])
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
