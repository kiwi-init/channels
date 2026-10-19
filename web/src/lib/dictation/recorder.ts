export const SAMPLE_RATE = 16_000

export interface Recording {
  stop(): Promise<Float32Array>
  cancel(): void
}

export async function toSpeech(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
  return audio.getChannelData(0)
}

export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const release = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  recorder.start()
  return {
    stop: () =>
      new Promise<Float32Array>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          toSpeech(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject)
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== "inactive") recorder.stop()
      release()
    },
  }
}
