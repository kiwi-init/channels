import type { Playback } from "./grok"
import { VOICE_RATE, floatToPcm } from "./pcm"
import type { Mic } from "./talk"

const FRAME = 4096

export async function openMic(onPcm: (pcm: Int16Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const tap = ctx.createScriptProcessor(FRAME, 1, 1)
  const silent = ctx.createGain()
  silent.gain.value = 0
  tap.onaudioprocess = (e) => onPcm(floatToPcm(e.inputBuffer.getChannelData(0), ctx.sampleRate))
  source.connect(tap)
  tap.connect(silent)
  silent.connect(ctx.destination)
  return {
    stop: () => {
      tap.onaudioprocess = null
      source.disconnect()
      tap.disconnect()
      for (const t of stream.getTracks()) t.stop()
      void ctx.close()
    },
  }
}

export function openSpeaker(): Playback & { close(): void } {
  const ctx = new AudioContext({ sampleRate: VOICE_RATE })
  let playing: { itemId: string; startedAt: number; endsAt: number; sources: AudioBufferSourceNode[] } | null = null

  return {
    play(itemId, pcm) {
      if (!pcm.length) return
      const buffer = ctx.createBuffer(1, pcm.length, VOICE_RATE)
      const samples = buffer.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i]! / 0x8000
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      const now = ctx.currentTime
      if (!playing || playing.itemId !== itemId || playing.endsAt < now) playing = { itemId, startedAt: Math.max(now, playing?.endsAt ?? now), endsAt: Math.max(now, playing?.endsAt ?? now), sources: [] }
      source.start(playing.endsAt)
      playing.endsAt += buffer.duration
      playing.sources.push(source)
    },
    stop() {
      const p = playing
      playing = null
      if (!p) return null
      const now = ctx.currentTime
      for (const s of p.sources) s.stop()
      if (now >= p.endsAt) return null
      return { itemId: p.itemId, playedMs: Math.max(0, (now - p.startedAt) * 1000) }
    },
    close() {
      playing = null
      void ctx.close()
    },
  }
}
