export type Device = "webgpu" | "wasm"

interface GpuAdapter {
  readonly isFallbackAdapter?: boolean
  readonly info?: { readonly isFallbackAdapter?: boolean }
}

export interface Gpu {
  requestAdapter(): Promise<GpuAdapter | null>
}

function gpuOf(): Gpu | undefined {
  const found: unknown = typeof navigator === "undefined" ? undefined : Reflect.get(navigator, "gpu")
  return found && typeof (found as Gpu).requestAdapter === "function" ? (found as Gpu) : undefined
}

export async function pickDevice(gpu: Gpu | undefined = gpuOf()): Promise<Device> {
  if (!gpu) return "wasm"
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return "wasm"
    return "webgpu"
  } catch {
    // No adapter we can ask: the CPU path works everywhere.
    return "wasm"
  }
}
