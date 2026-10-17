import { act, renderHook } from "@testing-library/react-native"

import { MAX_ATTACHMENTS, type Picked, type Platform } from "./attachments"
import { useAttachments } from "./useAttachments"

const image = (i: number, over: Partial<Picked> = {}): Picked => ({ uri: `file:///${i}.png`, name: `${i}.png`, mime: "image/png", size: 1000, width: 100, height: 100, ...over })

function device(picks: Picked[][]): Platform {
  let n = 0
  return {
    pick: jest.fn(async () => picks.shift() ?? []),
    shrink: jest.fn(async (_p, width) => ({ uri: `file:///s-${width}.jpg`, size: 1000 })),
    readBase64: async (uri) => `b64(${uri})`,
    newId: () => `id-${++n}`,
  }
}

describe("useAttachments", () => {
  it("adds what was picked, takes one away, and clears", async () => {
    const platform = device([[image(1), image(2)]])
    const { result } = await renderHook(() => useAttachments({ platform, onProblem: jest.fn() }))
    expect(result.current.attachments).toEqual([])
    await act(async () => result.current.pick())
    expect(result.current.attachments.map((a) => a.name)).toEqual(["1.png", "2.png"])
    await act(async () => result.current.remove("id-1"))
    expect(result.current.attachments.map((a) => a.name)).toEqual(["2.png"])
    await act(async () => result.current.clear())
    expect(result.current.attachments).toEqual([])
  })

  it("reports what could not be attached and keeps what could", async () => {
    const platform = device([[image(1), image(2, { mime: "video/mp4", name: "clip.mp4" })]])
    const onProblem = jest.fn()
    const { result } = await renderHook(() => useAttachments({ platform, onProblem }))
    await act(async () => result.current.pick())
    expect(result.current.attachments.map((a) => a.name)).toEqual(["1.png"])
    expect(onProblem).toHaveBeenCalledWith("clip.mp4 isn’t a PNG, JPEG, GIF, or WebP.")
  })

  it("tells the caller when the picker fails, and is not left busy", async () => {
    const platform = device([])
    platform.pick = jest.fn().mockRejectedValue(new Error("no permission"))
    const onProblem = jest.fn()
    const { result } = await renderHook(() => useAttachments({ platform, onProblem }))
    await act(async () => result.current.pick())
    expect(onProblem).toHaveBeenCalledWith("Couldn’t attach: no permission")
    expect(result.current.busy).toBe(false)
  })

  it("does not open the picker once eight are held", async () => {
    const eight = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => image(i))
    const platform = device([eight])
    const { result } = await renderHook(() => useAttachments({ platform, onProblem: jest.fn() }))
    await act(async () => result.current.pick())
    expect(result.current.attachments).toHaveLength(MAX_ATTACHMENTS)
    await act(async () => result.current.pick())
    expect(platform.pick).toHaveBeenCalledTimes(1)
  })

  it("reads the held images as base64, ready to send", async () => {
    const platform = device([[image(1)]])
    const { result } = await renderHook(() => useAttachments({ platform, onProblem: jest.fn() }))
    await act(async () => result.current.pick())
    expect(await result.current.files()).toEqual([{ name: "1.png", mime: "image/png", data: "b64(file:///1.png)" }])
  })
})
