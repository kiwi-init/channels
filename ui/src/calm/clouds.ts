const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }
`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float time;
uniform float later;
uniform float blend;
uniform sampler2D grain;
out vec4 color;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  return texture(grain, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 256.0).r;
}

const mat2 TURN = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * noise(p);
    p = TURN * p;
    amp *= 0.5;
  }
  return sum;
}

vec4 layer(vec2 uv, float t, float scale, float speed, float cover, int octaves, vec2 sun, vec3 air, float haze, float g, float h, float reach) {
  vec2 p = uv * scale;
  vec2 flow = vec2(t * speed, t * speed * 0.12);
  vec2 warp = vec2(fbm(p * 0.6 + flow * 0.4, 3), fbm(p * 0.6 + vec2(5.2, 1.3) - flow * 0.3, 3));
  vec2 q = p + flow + 0.9 * warp;
  float d = fbm(q, octaves);
  float edge = step(h, smoothstep(cover, cover + 0.1, d) * reach);
  float toward = fbm(q + sun * 0.16, 3);
  float below = fbm(q - vec2(0.0, 0.12), 2);
  float lit = clamp(0.55 + 5.0 * (d - toward), 0.0, 1.0);
  float under = clamp(2.4 * (below - cover), 0.0, 1.0);
  float body = smoothstep(cover, cover + 0.5, d);
  float tone = clamp(lit * (1.0 - 0.5 * body) + 0.3 * (1.0 - under), 0.0, 1.0);
  tone = clamp(floor(tone * 3.0 + g) / 3.0, 0.0, 1.0);
  vec3 c = mix(vec3(0.55, 0.63, 0.82), vec3(0.98, 0.96, 0.9), tone);
  c = mix(c, air, haze);
  return vec4(c, edge);
}

vec3 sky(vec2 frag, float t) {
  vec2 uv = frag / size.y;
  vec2 at = frag / size;
  float y = at.y;
  vec2 cell = floor(frag / max(1.0, size.y / 700.0));
  float g1 = hash(cell);
  float g2 = hash(cell + 17.3);
  float g3 = hash(cell + 41.9);
  float g4 = hash(cell + 73.1);
  float drift = 0.5 + 0.5 * sin(t * 0.021);
  float turn = t * 0.004;
  vec2 sun = normalize(vec2(-0.55 + 0.25 * cos(turn), 0.8 + 0.2 * sin(turn * 1.7)));
  vec2 sunAt = vec2(0.78 + 0.08 * cos(turn), 0.86 + 0.05 * sin(turn * 1.7));
  float light = mix(0.94, 1.0, 0.5 + 0.5 * sin(t * 0.026 + 1.3));
  vec3 zenith = vec3(0.2, 0.42, 0.8);
  vec3 horizon = vec3(0.7, 0.83, 0.95);
  float glow = exp(-6.0 * length((at - sunAt) * vec2(size.x / size.y, 1.0)));
  float rise = clamp(pow(smoothstep(0.0, 1.0, y), 0.8) - glow * 0.9, 0.0, 1.0);
  rise = floor(rise * 6.0 + g1) / 6.0;
  vec3 c = mix(horizon, zenith, rise);
  c = mix(c, vec3(1.0, 0.97, 0.88), step(g2, smoothstep(0.35, 0.9, glow)));
  vec3 air = mix(c, horizon, 0.5);
  vec4 far = layer(uv + vec2(0.0, 0.3), t, 5.0, 0.007, mix(0.5, 0.56, drift), 4, sun, air, 0.45, g3, g4, 1.0);
  c = mix(c, far.rgb, far.a);
  vec4 mid = layer(uv + vec2(7.3, 0.1), t, 2.8, 0.011, mix(0.47, 0.53, 1.0 - drift), 5, sun, air, 0.18, g2, g1, 1.0);
  c = mix(c, mid.rgb, mid.a);
  vec4 near = layer(uv + vec2(3.1, -0.2), t, 1.6, 0.016, 0.5, 5, sun, air, 0.0, g4, g3, smoothstep(1.05, 0.2, y));
  c = mix(c, near.rgb, near.a);
  c *= light;
  c += (g3 - 0.5) * 0.07;
  return c;
}

void main() {
  vec3 c = sky(gl_FragCoord.xy, time);
  if (blend > 0.0) c = mix(c, sky(gl_FragCoord.xy, later), blend);
  color = vec4(c, 1.0);
}
`

const BUDGET = 1_500_000
const STILL_EVERY = 30_000
const STILL_FADE = 4_000
const STILL_STEP = 45

export interface CloudOptions {
  still?: boolean
  seed?: number
  measure?: (ms: number) => void
}

export interface Clouds {
  stop(): void
}

export function scaleFor(width: number, height: number, ratio: number): number {
  const area = Math.max(1, width * height)
  return Math.min(ratio, Math.max(0.5, Math.sqrt(BUDGET / area)))
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const linked = vertex && fragment ? gl.createProgram() : null
  if (linked && vertex && fragment) {
    gl.attachShader(linked, vertex)
    gl.attachShader(linked, fragment)
    gl.linkProgram(linked)
  }
  if (vertex) gl.deleteShader(vertex)
  if (fragment) gl.deleteShader(fragment)
  if (linked && gl.getProgramParameter(linked, gl.LINK_STATUS)) return linked
  if (linked) gl.deleteProgram(linked)
  return null
}

export function startClouds(canvas: HTMLCanvasElement, options: CloudOptions = {}): Clouds | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false })
  if (!gl) return null
  const linked = program(gl)
  if (!linked) return null
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const corner = gl.getAttribLocation(linked, "corner")
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
  gl.useProgram(linked)
  const size = gl.getUniformLocation(linked, "size")
  const time = gl.getUniformLocation(linked, "time")
  const later = gl.getUniformLocation(linked, "later")
  const blend = gl.getUniformLocation(linked, "blend")
  const grain = gl.createTexture()
  const values = new Uint8Array(256 * 256)
  for (let i = 0; i < values.length; i++) values[i] = Math.floor(Math.random() * 256)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, grain)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, values)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.uniform1i(gl.getUniformLocation(linked, "grain"), 0)

  const probe = new Uint8Array(4)
  const seed = options.seed ?? (Date.now() / 1000) % 5000
  const began = performance.now()
  let frame = 0
  let stopped = false
  let lost = false

  const fit = () => {
    const box = canvas.getBoundingClientRect()
    const scale = scaleFor(box.width, box.height, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(box.width * scale))
    const height = Math.max(1, Math.round(box.height * scale))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.uniform2f(size, width, height)
  }

  const draw = (now: number) => {
    if (lost) return
    const elapsed = now - began
    if (options.still) {
      const round = Math.floor(elapsed / STILL_EVERY)
      const into = elapsed - round * STILL_EVERY
      gl.uniform1f(time, seed + round * STILL_STEP)
      gl.uniform1f(later, seed + (round + 1) * STILL_STEP)
      gl.uniform1f(blend, into > STILL_EVERY - STILL_FADE ? (into - (STILL_EVERY - STILL_FADE)) / STILL_FADE : 0)
    } else {
      gl.uniform1f(time, seed + elapsed / 1000)
      gl.uniform1f(blend, 0)
    }
    const start = options.measure ? performance.now() : 0
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (options.measure) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe)
      options.measure(performance.now() - start)
    }
  }

  let resting = 0
  const still = (now: number) => {
    const into = (now - began) % STILL_EVERY
    return options.still && into < STILL_EVERY - STILL_FADE
  }
  const tick = (now: number) => {
    frame = 0
    if (stopped || document.hidden) return
    draw(now)
    if (still(now)) {
      const wait = STILL_EVERY - STILL_FADE - ((now - began) % STILL_EVERY)
      resting = window.setTimeout(() => (frame = requestAnimationFrame(tick)), wait)
      return
    }
    frame = requestAnimationFrame(tick)
  }
  const run = () => {
    if (stopped || frame || document.hidden) return
    window.clearTimeout(resting)
    frame = requestAnimationFrame(tick)
  }
  const pause = () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(resting)
    frame = 0
  }
  const shown = () => (document.hidden ? pause() : run())
  const resized = new ResizeObserver(() => {
    fit()
    if (!frame) draw(performance.now())
  })
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    pause()
  }

  fit()
  resized.observe(canvas)
  document.addEventListener("visibilitychange", shown)
  canvas.addEventListener("webglcontextlost", onLost)
  run()

  return {
    stop() {
      if (stopped) return
      stopped = true
      pause()
      resized.disconnect()
      document.removeEventListener("visibilitychange", shown)
      canvas.removeEventListener("webglcontextlost", onLost)
      if (!lost) {
        gl.deleteBuffer(buffer)
        gl.deleteTexture(grain)
        gl.deleteProgram(linked)
        gl.getExtension("WEBGL_lose_context")?.loseContext()
      }
    },
  }
}
