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
out vec4 color;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
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

float density(vec2 p, float t, float speed, int octaves) {
  vec2 flow = vec2(t * speed, t * speed * 0.12);
  vec2 warp = vec2(fbm(p * 0.6 + flow * 0.4, 3), fbm(p * 0.6 + vec2(5.2, 1.3) - flow * 0.3, 3));
  return fbm(p + flow + 0.9 * warp, octaves);
}

vec4 layer(vec2 uv, float t, float scale, float speed, float cover, float bright, int octaves, vec2 sun) {
  vec2 p = uv * scale;
  float d = density(p, t, speed, octaves);
  float edge = smoothstep(cover, cover + 0.14, d);
  float toward = density(p + sun * 0.18, t, speed, 4);
  float lit = clamp(0.62 + 3.2 * (d - toward), 0.0, 1.0);
  float body = smoothstep(cover, cover + 0.45, d);
  float shade = mix(0.34, 1.0, lit) * mix(1.0, 0.72, body) * bright;
  float rim = (1.0 - smoothstep(cover, cover + 0.07, d)) * edge * 0.5;
  return vec4(vec3(shade + rim * bright), edge);
}

vec3 sky(vec2 frag, float t) {
  vec2 uv = frag / size.y;
  float y = frag.y / size.y;
  float drift = 0.5 + 0.5 * sin(t * 0.021);
  float turn = t * 0.004;
  vec2 sun = normalize(vec2(-0.55 + 0.25 * cos(turn), 0.8 + 0.2 * sin(turn * 1.7)));
  float light = mix(0.82, 1.0, 0.5 + 0.5 * sin(t * 0.026 + 1.3));
  vec3 c = mix(vec3(0.19), vec3(0.045), smoothstep(0.0, 1.0, y));
  c += vec3(0.06) * light * exp(-4.0 * y);
  vec4 far = layer(uv + vec2(0.0, 0.3), t, 5.2, 0.007, mix(0.54, 0.6, drift), 0.46 * light, 5, sun);
  c = mix(c, far.rgb, far.a * 0.8);
  vec4 mid = layer(uv + vec2(7.3, 0.1), t, 3.0, 0.011, mix(0.53, 0.59, 1.0 - drift), 0.64 * light, 5, sun);
  c = mix(c, mid.rgb, mid.a * 0.92);
  vec4 near = layer(uv + vec2(3.1, -0.2), t, 1.7, 0.016, 0.56, 0.84 * light, 6, sun);
  c = mix(c, near.rgb, near.a * smoothstep(1.0, 0.25, y));
  vec2 v = frag / size - 0.5;
  c *= 1.0 - 0.5 * dot(v, v);
  return c;
}

void main() {
  vec3 c = sky(gl_FragCoord.xy, time);
  if (blend > 0.0) c = mix(c, sky(gl_FragCoord.xy, later), blend);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  color = vec4(c, 1.0);
}
`

const BUDGET = 2_000_000
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
      gl.finish()
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
        gl.deleteProgram(linked)
        gl.getExtension("WEBGL_lose_context")?.loseContext()
      }
    },
  }
}
