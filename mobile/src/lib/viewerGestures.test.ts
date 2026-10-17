import { createViewerGestures } from "./viewerGestures"
import { DOUBLE_TAP_SCALE, identity } from "./zoom"

const box = { width: 400, height: 800 }
const finger = (pageX: number, pageY: number) => ({ pageX, pageY })

function harness() {
  let clock = 1000
  const shown: unknown[] = []
  const sprung: unknown[] = []
  const onClose = jest.fn()
  const g = createViewerGestures({ box, show: (t) => shown.push(t), springTo: (t) => sprung.push(t), onClose, now: () => clock })
  return { g, shown, sprung, onClose, tick: (ms: number) => void (clock += ms) }
}

describe("viewer gestures", () => {
  it("scales as two fingers move apart and keeps the scale after they lift", () => {
    const { g, shown, sprung } = harness()
    g.grant()
    g.move([finger(0, 0), finger(100, 0)], 0, 0)
    g.move([finger(0, 0), finger(200, 0)], 0, 0)
    expect(shown.at(-1)).toMatchObject({ scale: 2 })
    g.release(0, 0)
    expect(sprung.at(-1)).toMatchObject({ scale: 2 })
  })

  it("moves a zoomed image with one finger, and does not jump when a second finger lifts", () => {
    const { g, shown } = harness()
    g.grant()
    g.move([finger(0, 0), finger(100, 0)], 0, 0)
    g.move([finger(0, 0), finger(300, 0)], 0, 0)
    g.move([finger(10, 10)], 30, 20)
    expect(shown.at(-1)).toMatchObject({ scale: 3, x: 0, y: 0 })
    g.move([finger(50, 50)], 70, 60)
    expect(shown.at(-1)).toMatchObject({ scale: 3, x: 40, y: 40 })
  })

  it("zooms in on a double tap and back out on the next", () => {
    const { g, sprung, tick } = harness()
    g.grant()
    g.release(1, 1)
    expect(sprung).toEqual([])
    tick(150)
    g.grant()
    g.release(0, 0)
    expect(sprung.at(-1)).toEqual({ scale: DOUBLE_TAP_SCALE, x: 0, y: 0 })
    tick(1000)
    g.grant()
    g.release(0, 0)
    tick(100)
    g.grant()
    g.release(0, 0)
    expect(sprung.at(-1)).toEqual(identity)
  })

  it("does not call two taps far apart in time a double tap", () => {
    const { g, sprung, tick } = harness()
    g.grant()
    g.release(0, 0)
    tick(900)
    g.grant()
    g.release(0, 0)
    expect(sprung).toEqual([])
  })

  it("closes on a drag down at 1x, and springs back on a short one", () => {
    const first = harness()
    first.g.grant()
    first.g.move([finger(0, 0)], 5, 200)
    first.tick(400)
    first.g.release(5, 200)
    expect(first.onClose).toHaveBeenCalledTimes(1)

    const second = harness()
    second.g.grant()
    second.g.move([finger(0, 0)], 0, 60)
    second.tick(400)
    second.g.release(0, 60)
    expect(second.onClose).not.toHaveBeenCalled()
    expect(second.sprung.at(-1)).toEqual(identity)
  })

  it("starts again from 1x after a reset", () => {
    const { g, shown } = harness()
    g.grant()
    g.move([finger(0, 0), finger(100, 0)], 0, 0)
    g.move([finger(0, 0), finger(200, 0)], 0, 0)
    g.reset()
    g.grant()
    g.move([finger(0, 0), finger(100, 0)], 0, 0)
    g.move([finger(0, 0), finger(150, 0)], 0, 0)
    expect(shown.at(-1)).toMatchObject({ scale: 1.5 })
  })
})
