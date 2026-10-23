import { describe, expect, test } from "bun:test"

import { drawsInSoftware } from "./drawing"

describe("drawsInSoftware", () => {
  test("a renderer that draws with the CPU, or no WebGL at all, is software", () => {
    expect(drawsInSoftware("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)")).toBe(true)
    expect(drawsInSoftware("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true)
    expect(drawsInSoftware("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true)
    expect(drawsInSoftware(null)).toBe(true)
  })

  test("a GPU is not", () => {
    expect(drawsInSoftware("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)")).toBe(false)
    expect(drawsInSoftware("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false)
    expect(drawsInSoftware("")).toBe(false)
  })
})
