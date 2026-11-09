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

test("an AFK or Calm choice kept from before AFK went is dropped without error", () => {
  const kept = readPrefs(storeOf({ "ui.prefs": JSON.stringify({ afk: 10, calm: 5, enterSends: false }) }))
  expect(kept.enterSends).toBe(false)
  expect(Object.keys(kept)).not.toContain("afk")
  expect(Object.keys(kept)).not.toContain("calm")
})
