import { DOUBLE_TAP_SCALE, MAX_SCALE, clampPan, clampScale, dismissed, doubleTap, gap, identity, isTap, pan, pinch, settle } from "./zoom"

const box = { width: 400, height: 800 }

describe("zoom", () => {
  it("clamps the scale to 1..4", () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(2)).toBe(2)
    expect(clampScale(9)).toBe(MAX_SCALE)
  })

  it("keeps a zoomed image from being dragged past its edges", () => {
    expect(clampPan({ scale: 2, x: 500, y: -900 }, box)).toEqual({ scale: 2, x: 200, y: -400 })
    expect(clampPan({ scale: 1, x: 50, y: 50 }, box)).toEqual({ scale: 1, x: 0, y: 0 })
    expect(clampPan({ scale: 3, x: 10, y: 20 }, box)).toEqual({ scale: 3, x: 10, y: 20 })
  })

  it("measures the gap between two touches", () => {
    expect(gap({ pageX: 0, pageY: 0 }, { pageX: 3, pageY: 4 })).toBe(5)
  })

  it("scales by how far the fingers moved apart, from where it started", () => {
    expect(pinch(identity, 100, 200, box).scale).toBe(2)
    expect(pinch({ scale: 2, x: 0, y: 0 }, 100, 150, box).scale).toBe(3)
    expect(pinch(identity, 100, 50, box).scale).toBeCloseTo(0.7)
    expect(pinch(identity, 100, 100000, box).scale).toBeCloseTo(MAX_SCALE * 1.2)
    expect(pinch(identity, 0, 100, box)).toEqual(identity)
  })

  it("moves a zoomed image within its edges, and at 1x only drags it down for dismissing", () => {
    expect(pan({ scale: 2, x: 0, y: 0 }, 50, -30, box)).toEqual({ scale: 2, x: 50, y: -30 })
    expect(pan({ scale: 2, x: 190, y: 0 }, 50, 0, box).x).toBe(200)
    expect(pan(identity, 40, 90, box)).toEqual({ scale: 1, x: 0, y: 90 })
  })

  it("settles a shrunk image back to 1x and a too-big one to 4x", () => {
    expect(settle({ scale: 0.8, x: 30, y: 10 }, box)).toEqual(identity)
    expect(settle({ scale: 4.6, x: 0, y: 0 }, box).scale).toBe(MAX_SCALE)
    expect(settle({ scale: 2, x: 900, y: 0 }, box).x).toBe(200)
  })

  it("zooms in on a double tap and out on the next", () => {
    expect(doubleTap(identity)).toEqual({ scale: DOUBLE_TAP_SCALE, x: 0, y: 0 })
    expect(doubleTap({ scale: 2.5, x: 40, y: 10 })).toEqual(identity)
  })

  it("dismisses on a long enough drag down at 1x, and never while zoomed", () => {
    expect(dismissed({ scale: 1, x: 0, y: 121 })).toBe(true)
    expect(dismissed({ scale: 1, x: 0, y: -121 })).toBe(true)
    expect(dismissed({ scale: 1, x: 0, y: 80 })).toBe(false)
    expect(dismissed({ scale: 2, x: 0, y: 500 })).toBe(false)
  })

  it("calls a short, still touch a tap", () => {
    expect(isTap(2, 3, 120)).toBe(true)
    expect(isTap(20, 0, 120)).toBe(false)
    expect(isTap(0, 0, 600)).toBe(false)
  })
})
