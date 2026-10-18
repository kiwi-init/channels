export const VOICE_RATE = 24000

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i]!, true)
  let out = ""
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

export function base64ToPcm(b64: string): Int16Array {
  const raw = atob(b64)
  const pcm = new Int16Array(raw.length >> 1)
  for (let i = 0; i < pcm.length; i++) {
    const lo = raw.charCodeAt(i * 2)
    const hi = raw.charCodeAt(i * 2 + 1)
    pcm[i] = (((hi << 8) | lo) << 16) >> 16
  }
  return pcm
}

export function floatToPcm(samples: Float32Array, from: number, to = VOICE_RATE): Int16Array {
  const length = from === to ? samples.length : Math.floor((samples.length * to) / from)
  const pcm = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const at = from === to ? i : (i * from) / to
    const left = Math.floor(at)
    const right = Math.min(left + 1, samples.length - 1)
    const s = samples[left]! + (samples[right]! - samples[left]!) * (at - left)
    const clamped = Math.max(-1, Math.min(1, s))
    pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
  }
  return pcm
}
