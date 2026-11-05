import {
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  BackSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  QuadMesh,
  Ray,
  Raycaster,
  RenderTarget,
  RGBAFormat,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGPURenderer,
  type Node,
} from "three/webgpu"
import {
  Discard,
  Fn,
  If,
  abs,
  atan,
  cameraPosition,
  color,
  cos,
  exp,
  float,
  floor,
  hash,
  instancedBufferAttribute,
  luminance,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl"

import type { CalmRow } from "~/calm/rows"

export interface Meadow {
  setRows(rows: readonly CalmRow[]): void
  setStill(still: boolean): void
  dispose(): void
}

type State = "form" | "drift" | "read" | "dream" | "rest" | "approach" | "needs" | "bloom"
type Flower = { x: number; z: number; h: number; kind: number }
type Word = { text: string; t0: number; life: number; mode: number; typeRate: number; x: number; y: number; keep: boolean }
type Mote = { x: number; y: number; vx: number; vy: number; ch: string; life: number; age: number; mode: number; target: boolean; morph: boolean }
type SayOpts = { life?: number; mode?: number; rate?: number }
type MoteOpts = { vx?: number; vy?: number; ch?: string; life?: number; mode?: number; target?: boolean; morph?: boolean }

const THOUGHTS = [
  "hm",
  "what if",
  "maybe",
  "listening",
  "wondering",
  "oh",
  "almost",
  "still here",
  "i like the wind",
  "so many petals",
  "{ }",
  "quiet",
  "one more word",
  "light",
  "learning",
  "here",
  "not sure yet",
  "soft",
  "ah",
]
const ATLAS_COLS = 16
const ATLAS_ROWS = 16
const OV_W = 320
const OV_H = 200
const DURATIONS: Partial<Record<State, number>> = { read: 7, dream: 10, rest: 15, bloom: 4, form: 4 }
const GLOW: Record<State, number> = { form: 1, drift: 1, read: 1.15, dream: 1.05, rest: 0.55, approach: 1.15, needs: 1.25, bloom: 1.4 }
const CHURN: Record<State, number> = { form: 8, drift: 2.5, read: 9, dream: 4, rest: 0.5, approach: 5, needs: 3, bloom: 12 }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x))
const smooth = (x: number): number => x * x * (3 - 2 * x)
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T

export async function startMeadow(stage: HTMLElement, glance: HTMLElement, still0: boolean): Promise<Meadow | null> {
  const small = Math.min(innerWidth, innerHeight) < 700
  const renderer = new WebGPURenderer({ antialias: false, alpha: false })
  try {
    await renderer.init()
  } catch {
    // Without WebGPU or WebGL 2 the haze behind the panel stays, and the panel still reads.
    renderer.dispose()
    return null
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.domElement.style.display = "block"
  renderer.domElement.style.width = "100%"
  renderer.domElement.style.height = "100%"
  stage.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 120)
  const camBase = new Vector3(0, 0.5, 1.3)
  const camLook = new Vector3(0, 0.92, -6)
  const disposables: { dispose(): void }[] = []

  const C = {
    skyTop: color(0x6e9ccb),
    skyLow: color(0xb7cde2),
    haze: color(0xe8e4dc),
    cloud: color(0xf6cdb8),
    cloud2: color(0xfbeee2),
    groundNear: color(0x7b8a45),
    groundFar: color(0xa9b487),
    stem: color(0x5e7a2e),
    stemLight: color(0xa9b75a),
    grass: color(0x6f8a34),
    grassTip: color(0xc8c27a),
    rose: color(0xc24f60),
    coral: color(0xea776b),
    peach: color(0xf7b89b),
    pinkTulip: color(0xf48fa0),
    cream: color(0xfff5e6),
    daisy: color(0xfffaf3),
    daisyPink: color(0xf9d9de),
    yolk: color(0xf2b63c),
    lilac: color(0xa69ad6),
    lilacLight: color(0xd8cff3),
    gold: color(0xffd28c),
    warm: color(0xffe8c2),
    apricot: color(0xf59a62),
    rosewood: color(0xa3304e),
    frost: color(0xf4f2ef),
    blush: color(0xe7a39a),
    ink: color(0x2a2340),
    white: color(0xffffff),
  }

  const uTime = uniform(0)
  const uWind = uniform(1)
  const uBeing = uniform(new Vector4(0, 0.9, -3, 1))
  const uBeingScr = uniform(new Vector4(0, 0, 60, 1))
  const uAttn = uniform(new Vector3(0, 0, 0))
  const uChurn = uniform(3)
  const uForm = uniform(0)
  const uCell = uniform(28)
  const uTexel = uniform(new Vector2(1 / 300, 1 / 200))
  const uCamPos = uniform(new Vector3())
  const uRight = uniform(new Vector3(1, 0, 0))
  const uUp = uniform(new Vector3(0, 1, 0))
  const uFwd = uniform(new Vector3(0, 0, -1))
  const uTan = uniform(0.3)
  const uAspect = uniform(1.6)
  const uKnocks = [0, 1, 2, 3].map(() => uniform(new Vector4(0, 0, -99, 0)))
  const uFrost = uniform(new Vector4(0, 0, 0, 0))
  const uFrostOn = uniform(0)
  const uAlert = uniform(0)

  const windLean = (xz: Node<"vec2">, seed: Node<"float">) => {
    const t = uTime
    const base = sin(t.mul(0.8).add(xz.x.mul(0.4)).add(xz.y.mul(0.25)).add(seed.mul(1.3))).mul(0.22)
    const wave = sin(xz.x.mul(0.3).add(xz.y.mul(0.12)).sub(t.mul(1.1)))
      .mul(0.5)
      .add(0.5)
    const gust = smoothstep(0.45, 1.0, wave).mul(0.75)
    const flutter = sin(t.mul(3.1).add(seed.mul(17.0))).mul(0.05)
    const w = base.add(gust).add(flutter).add(0.18).mul(uWind)
    const d = xz.sub(uBeing.xz)
    const push = d.div(d.length().add(0.05)).mul(exp(d.dot(d).mul(-5.0)).mul(0.3).mul(uBeing.w))
    return vec2(w.mul(0.3), w.mul(-0.05)).add(push)
  }

  const fogOf = (wp: Node<"vec3">) => smoothstep(5.0, 26.0, cameraPosition.distance(wp))
  const lightOf = (wp: Node<"vec3">) => {
    const d = wp.sub(uBeing.xyz)
    return exp(d.dot(d).mul(-3.2)).mul(uBeing.w)
  }
  const eligible = (e: Node<"float">) => float(0.2).add(e.clamp(0, 1).mul(0.8))

  const rtMaterial = <M extends MeshBasicNodeMaterial | SpriteNodeMaterial>(m: M): M => {
    m.transparent = true
    m.blending = NoBlending
    m.depthWrite = true
    m.depthTest = true
    m.side = DoubleSide
    disposables.push(m)
    return m
  }
  const geometry = <G extends { dispose(): void }>(g: G): G => {
    disposables.push(g)
    return g
  }

  let seed = 7
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const FG = small ? 10 : 18
  const FLOWERS = (small ? 700 : 1100) + FG
  const GRASS = small ? 4500 : 8000

  {
    const g = geometry(new PlaneGeometry(240, 240))
    g.rotateX(-Math.PI / 2)
    const m = rtMaterial(new MeshBasicNodeMaterial())
    m.colorNode = Fn(() => {
      const wp = positionWorld
      const n = mx_fractal_noise_float(vec3(wp.xz.mul(0.35), 1.0), 3, 2.0, 0.5)
        .mul(0.5)
        .add(0.5)
      const col = mix(C.groundNear, C.groundFar, smoothstep(2.0, 18.0, cameraPosition.distance(wp))).mul(n.mul(0.35).add(0.8))
      return mix(col.add(C.gold.mul(lightOf(wp).mul(0.25))), C.haze, fogOf(wp).mul(0.9))
    })()
    m.opacityNode = eligible(float(0))
    const mesh = new Mesh(g, m)
    mesh.position.z = -60
    scene.add(mesh)
  }

  const fData = new Float32Array(FLOWERS * 4)
  const fKind = new Float32Array(FLOWERS * 4)
  const flowerList: Flower[] = []
  for (let i = 0; i < FLOWERS; i++) {
    let x: number
    let z: number
    const fg = i < FG
    if (fg) {
      z = -0.75 - rand() * 1.1
      x = (i % 2 ? 1 : -1) * (0.55 + rand() * 1.3)
    } else {
      do {
        z = -0.7 - 21 * Math.pow(rand(), 1.25)
        x = (rand() * 2 - 1) * (1.2 + Math.abs(z) * 0.72)
      } while (z > -1.9 && Math.abs(x) < 1.0)
    }
    const r = rand()
    const kind = fg ? (r < 0.7 ? 0 : 1) : r < 0.42 ? 0 : r < 0.82 ? 1 : 2
    let h = kind === 0 ? 0.5 + rand() * 0.42 : kind === 1 ? 0.32 + rand() * 0.4 : 0.22 + rand() * 0.3
    let size = kind === 0 ? 0.15 + rand() * 0.04 : kind === 1 ? 0.13 + rand() * 0.04 : 0.08 + rand() * 0.03
    if (fg) {
      h = 0.62 + rand() * 0.42
      size *= 1.15
    }
    fData.set([x, z, h, rand()], i * 4)
    fKind.set([kind, size, rand(), 0], i * 4)
    flowerList.push({ x, z, h, kind })
  }
  const fDataAttr = new InstancedBufferAttribute(fData, 4)
  const fKindAttr = new InstancedBufferAttribute(fKind, 4)

  {
    const g = geometry(new PlaneGeometry(1, 1, 1, 6))
    const m = rtMaterial(new MeshBasicNodeMaterial())
    const inst = instancedBufferAttribute<"vec4">(fDataAttr)
    const kind = instancedBufferAttribute<"vec4">(fKindAttr)
    const f = positionGeometry.y.add(0.5)
    const lean = windLean(inst.xy, inst.w)
    const bend = f.mul(f)
    const width = select(kind.x.lessThan(0.5), float(0.022), float(0.014))
    m.positionNode = vec3(
      inst.x.add(positionGeometry.x.mul(width)).add(lean.x.mul(bend).mul(inst.z)),
      f.mul(inst.z).mul(float(1).sub(lean.x.mul(lean.x).mul(0.4).mul(bend))),
      inst.y.add(lean.y.mul(bend).mul(inst.z))
    )
    m.colorNode = Fn(() => {
      const wp = positionWorld
      const col = mix(C.stem, C.stemLight, f.mul(0.7).add(abs(positionGeometry.x).oneMinus().mul(0.2)))
      return mix(col.add(C.gold.mul(lightOf(wp).mul(0.35))), C.haze, fogOf(wp).mul(0.85))
    })()
    m.opacityNode = eligible(smoothstep(15.0, 6.0, cameraPosition.distance(positionWorld)).mul(0.9))
    const mesh = new InstancedMesh(g, m, FLOWERS)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  {
    const g = geometry(new PlaneGeometry(1, 1, 1, 5))
    const m = rtMaterial(new MeshBasicNodeMaterial())
    const inst = instancedBufferAttribute<"vec4">(fDataAttr)
    const kind = instancedBufferAttribute<"vec4">(fKindAttr)
    const isTulip = step(kind.x, 0.5)
    const f = positionGeometry.y.add(0.5)
    const lean = windLean(inst.xy.add(0.3), inst.w.add(0.5))
    const side = select(inst.w.greaterThan(0.5), float(1), float(-1))
    const lh = inst.z.mul(0.55).mul(isTulip)
    const bend = f.mul(f)
    m.positionNode = vec3(inst.x.add(positionGeometry.x.mul(0.07)).add(side.mul(bend).mul(0.12)).add(lean.x.mul(bend).mul(lh).mul(1.3)), f.mul(lh).mul(float(1).sub(bend.mul(0.25))), inst.y.add(0.01))
    m.colorNode = Fn(() => {
      const p = uv()
      const half = pow(sin(p.y.mul(Math.PI)), 0.8)
        .mul(0.5)
        .mul(p.y.oneMinus().mul(0.5).add(0.5))
      If(abs(p.x.sub(0.5)).greaterThan(half), () => {
        Discard()
      })
      If(isTulip.lessThan(0.5), () => {
        Discard()
      })
      const wp = positionWorld
      const col = mix(C.stem, C.stemLight, p.y.mul(0.6).add(abs(p.x.sub(0.5)).mul(0.6)))
      return mix(col.add(C.gold.mul(lightOf(wp).mul(0.3))), C.haze, fogOf(wp).mul(0.85))
    })()
    m.opacityNode = eligible(smoothstep(15.0, 6.0, cameraPosition.distance(positionWorld)).mul(0.75))
    const mesh = new InstancedMesh(g, m, FLOWERS)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  {
    const m = rtMaterial(new SpriteNodeMaterial())
    const inst = instancedBufferAttribute<"vec4">(fDataAttr)
    const kind = instancedBufferAttribute<"vec4">(fKindAttr)
    const lean = windLean(inst.xy, inst.w)
    m.positionNode = vec3(inst.x.add(lean.x.mul(inst.z)), inst.z.mul(float(1).sub(lean.x.mul(lean.x).mul(0.4))).add(kind.y.mul(0.3)), inst.y.add(lean.y.mul(inst.z)))
    m.rotationNode = lean.x.mul(-1.1)
    m.scaleNode = kind.y.mul(2.2)
    m.colorNode = Fn(() => {
      const p = uv().sub(0.5).toVar()
      const out = vec3(0).toVar()
      const k = kind.x
      If(k.lessThan(0.5), () => {
        const e = vec2(p.x.mul(1.3), p.y.add(0.06)).length()
        const top = float(0.17).add(cos(p.x.mul(15.0)).mul(0.07))
        If(e.greaterThan(0.36).or(p.y.greaterThan(top)), () => {
          Discard()
        })
        const g = smoothstep(-0.34, 0.24, p.y)
        const tint = mix(C.coral, mix(C.peach, C.pinkTulip, step(0.5, kind.z)), kind.z.mul(0.6))
        const body = mix(C.rose, tint, g)
        const lit = smoothstep(0.02, 0.22, p.y)
          .mul(0.6)
          .add(smoothstep(0.05, -0.25, p.x).mul(0.25))
        out.assign(mix(body, C.cream, lit.clamp(0, 0.85)))
      })
        .ElseIf(k.lessThan(1.5), () => {
          const q = vec2(p.x, p.y.mul(1.6))
          const r = q.length()
          const th = atan(q.y, q.x)
          const edge = float(0.44).mul(float(0.8).add(abs(cos(th.mul(7.0))).mul(0.2)))
          If(r.greaterThan(edge), () => {
            Discard()
          })
          const petal = mix(C.daisy, C.daisyPink, kind.z.mul(0.7)).mul(float(0.82).add(r.mul(0.5)))
          out.assign(mix(C.yolk, petal, smoothstep(0.09, 0.13, r)))
        })
        .Else(() => {
          const r = p.length()
          const th = atan(p.y, p.x)
          const edge = float(0.42).mul(float(0.7).add(abs(cos(th.mul(2.5))).mul(0.3)))
          If(r.greaterThan(edge), () => {
            Discard()
          })
          out.assign(mix(C.lilacLight, C.lilac, smoothstep(0.05, 0.35, r)))
        })
      const wp = positionWorld
      return mix(out.add(C.gold.mul(lightOf(wp).mul(0.45))), C.haze, fogOf(wp).mul(0.8))
    })()
    m.opacityNode = eligible(smoothstep(16.0, 6.5, cameraPosition.distance(positionWorld)))
    const heads = new Sprite(m)
    heads.count = FLOWERS
    heads.frustumCulled = false
    scene.add(heads)
  }

  {
    const gData = new Float32Array(GRASS * 4)
    for (let i = 0; i < GRASS; i++) {
      const z = -0.4 - 19 * Math.pow(rand(), 1.3)
      const x = (rand() * 2 - 1) * (1.3 + Math.abs(z) * 0.75)
      gData.set([x, z, 0.12 + rand() * 0.28, rand()], i * 4)
    }
    const attr = new InstancedBufferAttribute(gData, 4)
    const g = geometry(new PlaneGeometry(1, 1, 1, 3))
    const m = rtMaterial(new MeshBasicNodeMaterial())
    const inst = instancedBufferAttribute<"vec4">(attr)
    const f = positionGeometry.y.add(0.5)
    const lean = windLean(inst.xy, inst.w).mul(1.5)
    const bend = f.mul(f)
    m.positionNode = vec3(inst.x.add(positionGeometry.x.mul(0.03).mul(f.oneMinus())).add(lean.x.mul(bend).mul(inst.z)), f.mul(inst.z), inst.y.add(lean.y.mul(bend).mul(inst.z)))
    m.colorNode = Fn(() => {
      const wp = positionWorld
      const col = mix(C.grass, C.grassTip, f.mul(0.8).add(inst.w.mul(0.2)))
      return mix(col.add(C.gold.mul(lightOf(wp).mul(0.3))), C.haze, fogOf(wp).mul(0.85))
    })()
    m.opacityNode = eligible(smoothstep(9.0, 3.5, cameraPosition.distance(positionWorld)).mul(0.32))
    const mesh = new InstancedMesh(g, m, GRASS)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  const hazeClear = new Color(0xe8e4dc)
  const rtScene = new RenderTarget(300, 200, { type: HalfFloatType, depthBuffer: true })
  disposables.push(rtScene)

  const atlasCanvas = document.createElement("canvas")
  const atlasTex = new CanvasTexture(atlasCanvas)
  atlasTex.flipY = false
  atlasTex.generateMipmaps = false
  atlasTex.minFilter = LinearFilter
  atlasTex.colorSpace = NoColorSpace
  disposables.push(atlasTex)
  const charSlots = new Map<string, number>()
  for (let c = 32; c < 127; c++) charSlots.set(String.fromCharCode(c), c - 32)
  for (const ch of ["·", "●", "…", "—", "›", "○"]) charSlots.set(ch, charSlots.size)
  const glyphIndex = (ch: string): number => charSlots.get(ch) ?? charSlots.get("?") ?? 0

  const monoFamily = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "ui-monospace, Menlo, monospace"
  const drawAtlas = (): void => {
    const S = 64
    atlasCanvas.width = S * ATLAS_COLS
    atlasCanvas.height = S * ATLAS_ROWS
    const g = atlasCanvas.getContext("2d")
    if (!g) return
    g.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height)
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.font = `400 ${Math.round(S * 0.62)}px ${monoFamily}`
    for (const [ch, i] of charSlots) {
      const x = (i % ATLAS_COLS) * S + S / 2
      const y = Math.floor(i / ATLAS_COLS) * S + S / 2 + S * 0.02
      g.save()
      g.shadowColor = "rgba(255,255,255,0.95)"
      g.shadowBlur = S * 0.16
      g.globalAlpha = 0.7
      g.fillStyle = "#fff"
      g.fillText(ch, x, y)
      g.restore()
      g.fillStyle = "#fff"
      g.fillText(ch, x, y)
    }
    atlasTex.needsUpdate = true
  }
  const glyphA = (gi: Node<"float">, local: Node<"vec2">) => {
    const col = gi.mod(ATLAS_COLS)
    const row = floor(gi.div(ATLAS_COLS))
    return texture(atlasTex, vec2(col.add(local.x.mul(0.9).add(0.05)).div(ATLAS_COLS), row.add(local.y.mul(0.9).add(0.05)).div(ATLAS_ROWS))).a
  }

  const ovData = new Uint8Array(OV_W * OV_H * 4)
  const ovTex = new DataTexture(ovData, OV_W, OV_H, RGBAFormat, UnsignedByteType)
  ovTex.magFilter = NearestFilter
  ovTex.minFilter = NearestFilter
  ovTex.generateMipmaps = false
  ovTex.colorSpace = NoColorSpace
  ovTex.needsUpdate = true
  disposables.push(ovTex)

  const rayDir = (suv: Node<"vec2">) => normalize(uFwd.add(uRight.mul(suv.x.mul(2).sub(1).mul(uTan).mul(uAspect))).add(uUp.mul(suv.y.mul(-2).add(1).mul(uTan))))
  const glassAt = (suv: Node<"vec2">) => {
    const rd = rayDir(suv)
    return uCamPos.add(rd.mul(uCamPos.z.negate().div(rd.z.min(-1e-4)))).xy
  }
  const ripple = (suv: Node<"vec2">) => {
    const wp = glassAt(suv)
    let off: Node<"vec2"> = vec2(0)
    let shine: Node<"float"> = float(0)
    for (const k of uKnocks) {
      const age = uTime.sub(k.z)
      const dv = wp.sub(k.xy)
      const d = dv.length()
      const front = age.mul(1.0)
      const env = exp(age.mul(-1.5)).mul(k.w).mul(step(0.0, age))
      const ring = sin(d.sub(front).mul(24.0))
        .mul(exp(abs(d.sub(front)).mul(-6.0)))
        .mul(env)
      off = off.add(dv.div(d.add(0.001)).mul(ring))
      shine = shine.add(ring)
    }
    return { off, shine, wp }
  }

  {
    const m = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, depthTest: false })
    m.blending = NoBlending
    m.colorNode = Fn(() => {
      const suv = screenUV
      const rd = rayDir(suv).toVar()
      const col = mix(mix(C.haze, C.skyLow, smoothstep(-0.02, 0.12, rd.y)), C.skyTop, smoothstep(0.1, 0.5, rd.y)).toVar()
      const drift = uTime.mul(0.012).mul(uWind)
      const cn = mx_fractal_noise_float(vec3(suv.x.mul(uAspect).mul(1.3).sub(drift), suv.y.mul(2.2), uTime.mul(0.015)), 3, 2.0, 0.5)
        .mul(0.5)
        .add(0.5)
      const clouds = smoothstep(0.52, 0.78, cn).mul(smoothstep(0.65, 0.1, suv.y))
      col.assign(mix(col, mix(C.cloud2, C.cloud, suv.x.oneMinus().mul(0.7)), clouds.mul(0.7)))
      const cq = suv.sub(vec2(0.08, 0.1)).mul(vec2(uAspect, 1.0))
      col.assign(mix(col, C.cloud, exp(cq.dot(cq).mul(-8.0)).mul(0.6)))
      return col
    })()
    m.opacityNode = float(0)
    disposables.push(m)
    const dome = new Mesh(geometry(new SphereGeometry(100, 24, 12)), m)
    dome.renderOrder = -100
    dome.frustumCulled = false
    scene.add(dome)
  }

  const sceneBlur = (u: Node<"vec2">, r: Node<"vec2">) => {
    let acc: Node<"vec4"> = texture(rtScene.texture, u).mul(0.16)
    for (let ring = 1; ring <= 2; ring++) {
      for (let j = 0; j < 6; j++) {
        const a = ((j + ring * 0.5) / 6) * Math.PI * 2
        acc = acc.add(texture(rtScene.texture, u.add(vec2(Math.cos(a), Math.sin(a)).mul(r).mul(ring))).mul(ring === 1 ? 0.09 : 0.05))
      }
    }
    return acc
  }

  const RAMP = [".", "e", "/", "+", "*", "=", "2"].map(glyphIndex)
  const rampGlyph = (gi: Node<"float">) => {
    let g: Node<"float"> = float(RAMP[0] ?? 0)
    for (let k = 1; k < RAMP.length; k++) g = g.add(step(k - 0.5, gi).mul((RAMP[k] ?? 0) - (RAMP[k - 1] ?? 0)))
    return g
  }

  const beingField = (pix: Node<"vec2">) => {
    const c = uBeingScr.xy.add(uAttn.xy.mul(uAttn.z).mul(uBeingScr.z).mul(0.12))
    const d = pix.sub(c).div(uBeingScr.z)
    const r = d.length()
    const th = atan(d.y, d.x)
    const n = mx_noise_float(vec3(cos(th).mul(1.4), sin(th).mul(1.4), uTime.mul(0.35)))
    const breath = sin(uTime.mul(1.1)).mul(0.05).add(1.0)
    const petals = float(1.0)
      .add(sin(th.mul(5.0).add(uTime.mul(0.3))).mul(0.13))
      .add(n.mul(0.22))
    const dens = smoothstep(1.0, 0.0, r.div(petals.mul(breath)))
    const lean = d.div(r.add(1e-3)).dot(uAttn.xy).mul(uAttn.z).mul(0.25)
    return { dens, r, lean }
  }

  const frostAt = (p: Node<"vec2">) => {
    const c = uFrost.xy.add(uFrost.zw).mul(0.5)
    const hs = uFrost.zw.sub(uFrost.xy).mul(0.5)
    const q = abs(p.sub(c)).sub(hs)
    const wobble = mx_noise_float(vec3(p.mul(0.003), uTime.mul(0.02)))
      .mul(uCell)
      .mul(2.5)
    const d = vec2(q.x.max(0), q.y.max(0))
      .length()
      .add(min(max(q.x, q.y), 0))
      .add(wobble)
    return smoothstep(uCell.mul(6.0), uCell.mul(-1.5), d).mul(uFrostOn)
  }

  const matOut = new NodeMaterial()
  disposables.push(matOut)
  matOut.fragmentNode = Fn(() => {
    const suv = screenUV.toVar()
    const pix = suv.mul(screenSize)
    const R1 = ripple(suv)
    const puv = suv.add(R1.off.mul(0.012)).toVar()

    const sb = sceneBlur(puv, uTexel.mul(1.7))
    const cover = smoothstep(0.0, 0.15, sb.a)
    const col = sb.rgb.toVar()
    const B = beingField(pix)
    const w = uBeingScr.w.min(1.6)
    col.assign(mix(col, C.apricot, exp(B.r.mul(B.r).mul(-1.2)).mul(0.62).mul(w).clamp(0, 0.92)))
    col.addAssign(
      C.warm.mul(
        exp(B.r.mul(B.r).mul(-2.6))
          .mul(0.25)
          .add(exp(B.r.mul(B.r).mul(-9.0)).mul(0.4))
          .mul(w)
      )
    )
    col.addAssign(C.white.mul(R1.shine.mul(0.04)))
    col.addAssign(C.white.mul(exp(abs(R1.wp.y).mul(-70)).mul(0.18)))

    col.assign(mix(col, col.mul(vec3(1.05, 0.9, 0.86)).add(vec3(0.025, 0.0, 0.0)), uAlert.mul(0.75)))

    const frost = frostAt(pix)
    col.assign(mix(col, mix(C.frost, C.blush, uAlert.mul(0.1)), frost.mul(mix(0.4, 0.58, uAlert))))

    const cellF = pix.div(uCell)
    const cid = floor(cellF)
    const local = cellF.sub(cid)
    const ccuv = cid.add(0.5).mul(uCell).div(screenSize)
    const ccpix = cid.add(0.5).mul(uCell)
    const R2 = ripple(ccuv)
    const s = texture(rtScene.texture, ccuv.add(R2.off.mul(0.012)))
    const h = hash(cid.x.mul(1.731).add(cid.y.mul(91.27)))
    const h2 = hash(cid.x.mul(5.17).add(cid.y.mul(13.9)).add(7.0))
    const reveal = smoothstep(h, h.add(0.15), uForm.mul(1.2))

    const elig = s.a.sub(0.2).div(0.8).clamp(0, 1)
    const shade = s.rgb
    const Lm = smoothstep(0.1, 0.62, luminance(shade))
    const frostC = frostAt(cid.add(0.5).mul(uCell))
    const fieldA = smoothstep(0.25, 0.6, elig)
      .mul(step(h2.mul(0.5), elig))
      .mul(reveal)
      .mul(frostC.oneMinus())
    const fieldG = rampGlyph(floor(Lm.mul(6.99)))
    const fieldC = mix(shade.mul(1.5).add(0.08), C.cream, smoothstep(0.3, 0.85, Lm))

    const BC = beingField(ccpix)
    const tick = floor(uTime.mul(uChurn).add(h.mul(9.0)))
    const t1 = hash(cid.x.mul(3.1).add(cid.y.mul(17.7)).add(tick.mul(0.618)))
    const t2 = hash(cid.y.mul(2.3).add(cid.x.mul(11.3)).add(tick.mul(1.37)))
    const letter = float(65).add(floor(t1.mul(26.0)))
    const bracket = select(t2.lessThan(0.25), float(91), select(t2.lessThan(0.5), float(93), select(t2.lessThan(0.75), float(28), float(30))))
    const beingG = select(t2.greaterThan(0.9).and(BC.dens.lessThan(0.7)), bracket, letter)
    const beingA = smoothstep(0.06, 0.3, BC.dens).mul(uBeingScr.w.min(1.0).mul(1.1)).mul(BC.lean.add(1.0)).mul(reveal).mul(frostC.mul(-0.9).add(1.0))
    const beingC = mix(C.cream, C.white, smoothstep(0.45, 0.95, BC.dens))

    const drift = vec3(cid.x.mul(0.07).sub(uTime.mul(0.22).mul(uWind)), cid.y.mul(0.09), uTime.mul(0.05))
    const mn = mx_noise_float(drift)
    const tw = hash(
      cid.x
        .mul(7.13)
        .add(cid.y.mul(131.7))
        .add(floor(uTime.mul(0.5).add(h.mul(10.0))))
    )
    const mistA = smoothstep(0.25, 0.55, mn).mul(step(0.95, tw)).mul(0.4).add(R2.shine.max(0).mul(1.1)).clamp(0, 0.9).mul(frostC.oneMinus())
    const mistG = select(h.greaterThan(0.55), float(95), select(h.greaterThan(0.25), float(14), float(11)))

    const ov = texture(ovTex, cid.add(0.5).div(vec2(OV_W, OV_H)))
    const ovA = ov.g.mul(step(cid.x, OV_W - 1)).mul(step(cid.y, OV_H - 1))
    const ovG = floor(ov.r.mul(255.0).add(0.5))
    const ovM = floor(ov.b.mul(255.0).add(0.5))
    const ovC = select(ovM.lessThan(0.5), C.cream, select(ovM.lessThan(1.5), C.gold, select(ovM.lessThan(2.5), C.rosewood, C.ink)))

    const useOv = ovA.greaterThan(0.02)
    const useBeing = beingA.greaterThan(0.05)
    const useField = fieldA.greaterThan(0.02)
    const gi = select(useOv, ovG, select(useBeing, beingG, select(useField, fieldG, mistG)))
    const ga0 = select(useOv, ovA, select(useBeing, beingA, select(useField, fieldA, mistA.mul(float(1).sub(cover.mul(0.6))))))
    const gc = vec3(select(useOv, ovC, select(useBeing, beingC, select(useField, fieldC, C.cream))))
    const isInk = select(useOv, step(1.5, ovM), float(0))

    const ga = glyphA(gi, local).mul(ga0.clamp(0, 1))
    const lit = mix(col.add(gc.mul(ga).mul(float(1).sub(col))), mix(col, gc, ga), select(useOv, float(0), select(useBeing, float(0.85), float(0))))
    const inked = mix(col, gc, ga.mul(0.92))
    const outCol = mix(lit, inked, isInk).toVar()

    const vig = smoothstep(1.25, 0.45, suv.sub(0.5).mul(vec2(uAspect, 1.0)).length())
    outCol.assign(outCol.mul(vig.mul(0.08).add(0.92)))
    outCol.assign(mix(outCol, C.blush, vig.oneMinus().mul(uAlert).mul(0.3)))
    const grain = hash(pix.x.floor().add(pix.y.floor().mul(1931.0)).add(uTime.mul(61.0).fract().mul(7919.0)))
      .sub(0.5)
      .mul(0.012)
    return vec4(outCol.add(grain), 1.0)
  })()
  const quadOut = new QuadMesh(matOut)

  const bufferSize = (): Vector2 => renderer.getDrawingBufferSize(new Vector2())
  const project = (v: Vector3): { x: number; y: number; behind: boolean } => {
    const p = v.clone().project(camera)
    const size = bufferSize()
    return { x: (p.x * 0.5 + 0.5) * size.x, y: (0.5 - p.y * 0.5) * size.y, behind: p.z > 1 }
  }

  const ov = {
    cell: 28,
    cols: 0,
    rows: 0,
    clear(): void {
      ovData.fill(0)
    },
    put(col: number, row: number, ch: string, alpha: number, mode: number): void {
      if (col < 0 || row < 0 || col >= Math.min(OV_W, this.cols) || row >= Math.min(OV_H, this.rows)) return
      const i = (row * OV_W + col) * 4
      const a = Math.round(clamp(alpha, 0, 1) * 255)
      if (a <= (ovData[i + 1] ?? 0)) return
      ovData[i] = glyphIndex(ch)
      ovData[i + 1] = a
      ovData[i + 2] = mode
    },
    putPx(x: number, y: number, ch: string, alpha: number, mode: number): void {
      this.put(Math.floor(x / this.cell), Math.floor(y / this.cell), ch, alpha, mode)
    },
    text(str: string, x: number, y: number, alpha: number, mode: number): void {
      const c0 = Math.floor(x / this.cell)
      const r = Math.floor(y / this.cell)
      for (let i = 0; i < str.length; i++) {
        const ch = str[i]
        if (ch && ch !== " ") this.put(c0 + i, r, ch, alpha, mode)
      }
    },
  }

  const words: Word[] = []
  const motes: Mote[] = []
  let simTime = 0

  const being = {
    pos: new Vector3(-0.2, 0.95, -3.4),
    vel: new Vector3(),
    goal: new Vector3(0.4, 1.0, -3.0),
    state: "form" as State,
    t: 0,
    dur: 4,
    glow: 0.2,
    churn: 3,
    scr: { x: 0, y: 0, r: 60 },
    nextThought: 3,
    reading: null as Flower | null,
    touchAt: 0,
  }

  const say = (text: string, opts: SayOpts = {}): void => {
    const sp = being.scr
    words.push({ text, t0: simTime, life: opts.life ?? 3.6, mode: opts.mode ?? 3, typeRate: opts.rate ?? 14, x: sp.x + sp.r * 1.15, y: sp.y - sp.r * 0.75, keep: false })
  }

  const windPx = (x: number, y: number, t: number): { vx: number; vy: number } => {
    const cell = ov.cell
    const gust = smooth(clamp((Math.sin(x * 0.0015 - t * 1.1) * 0.5 + 0.5 - 0.45) / 0.55, 0, 1))
    return { vx: (0.9 + 1.6 * gust + 0.4 * Math.sin(t * 0.8 + y * 0.01)) * cell * uWind.value, vy: Math.sin(t * 1.7 + x * 0.01) * 0.25 * cell }
  }

  const emitMote = (x: number, y: number, opts: MoteOpts = {}): void => {
    motes.push({
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      ch: opts.ch ?? pick([".", "·", "+", "*", "'", ","]),
      life: opts.life ?? 3 + Math.random() * 3,
      age: 0,
      mode: opts.mode ?? 0,
      target: opts.target ?? false,
      morph: opts.morph ?? false,
    })
  }

  let knockSlot = 0
  const knockAt = (x: number, y: number, strength: number): void => {
    uKnocks[knockSlot]?.value.set(x, y, uTime.value, strength)
    knockSlot = (knockSlot + 1) % uKnocks.length
  }
  const ray = new Raycaster()
  const rayAtPx = (px: number, py: number): Ray => {
    const size = bufferSize()
    ray.setFromCamera(new Vector2((px / size.x) * 2 - 1, -((py / size.y) * 2 - 1)), camera)
    return ray.ray
  }
  const pointAtDepthPx = (px: number, py: number, z: number): Vector3 => {
    const r = rayAtPx(px, py)
    return r.origin.clone().addScaledVector(r.direction, (z - r.origin.z) / r.direction.z)
  }

  let rows: CalmRow[] = []
  let bannerBox: { c1: number; r: number } | null = null
  const totalNeeds = (): number => rows.reduce((a, r) => a + r.needs, 0)

  const randomSpot = (): Vector3 => {
    const z = lerp(-6.5, -1.8, Math.random() ** 0.9)
    const half = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect * (camera.position.z - z) * 0.6
    return new Vector3((Math.random() * 2 - 1) * Math.min(2.6, half), 0.8 + Math.random() * 0.45, z)
  }

  const aimAtList = (): void => {
    if (!rows.some((r) => r.needs > 0)) return
    const size = bufferSize()
    const rDist = camera.position.z + 1.5
    const rPx = (0.4 / (rDist * Math.tan(MathUtils.degToRad(camera.fov / 2)))) * size.y * 0.5
    const fr = uFrost.value
    const midY = bannerBox ? (bannerBox.r + 0.5) * ov.cell : (fr.y + fr.w) / 2
    let px = fr.z + ov.cell * 2.5 + rPx * 1.2
    let py = clamp(midY, rPx * 1.05, size.y * 0.55)
    if (px > size.x - rPx * 1.05) {
      px = clamp(fr.x + rPx * 2.2, rPx * 1.2, size.x - rPx * 1.2)
      py = clamp(fr.w + ov.cell * 2.5 + rPx * 1.2, size.y * 0.2, size.y * 0.68)
    }
    const w = pointAtDepthPx(px, py, -1.5)
    being.goal.set(clamp(w.x, -2.4, 2.4), clamp(w.y, 0.6, 2.0), -1.5)
  }

  const setState = (s: State, dur?: number): void => {
    being.state = s
    being.t = 0
    being.dur = dur ?? DURATIONS[s] ?? 999
    if (s === "drift") being.goal.copy(randomSpot())
    if (s === "read") {
      const cands = flowerList.filter((f) => f.z < -1.6 && f.z > -6.5 && Math.abs(f.x) < 2.2)
      const f = pick(cands)
      being.reading = f
      being.goal.set(f.x, f.h + 0.36, f.z)
    }
    if (s === "rest") being.goal.set(being.pos.x, 0.55, being.pos.z)
    if (s === "dream") being.goal.set(being.pos.x * 0.8, 1.1, being.pos.z)
    if (s === "approach") aimAtList()
  }

  const nextState = (): void => {
    if (totalNeeds() > 0) return setState("approach")
    const prev = being.state
    const pool: [State, number][] = [
      ["drift", 3],
      ["read", 2],
      ["dream", 1.6],
      ["rest", prev === "rest" ? 0 : 0.9],
    ]
    const total = pool.reduce((a, [, w]) => a + w, 0)
    let r = Math.random() * total
    for (const [s, w] of pool) {
      r -= w
      if (r <= 0) return setState(s === prev && s !== "drift" ? "drift" : s)
    }
    setState("drift")
  }

  const bloom = (): void => {
    setState("bloom")
    being.glow = 1.8
    const sp = being.scr
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2
      const sp2 = (0.6 + Math.random() * 1.6) * ov.cell * 2.2
      emitMote(sp.x, sp.y, { vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, ch: pick(["*", "+", "·", "o", ".", "*"]), mode: Math.random() < 0.5 ? 1 : 0, life: 2.5 + Math.random() * 2.5 })
    }
    say("thank you", { mode: 2, life: 3.2, rate: 10 })
  }

  const drawRows = (): void => {
    const pr = renderer.getPixelRatio()
    const r = glance.getBoundingClientRect()
    if (!r.width || !r.height) {
      uFrostOn.value = 0
      bannerBox = null
      return
    }
    const pad = 14
    uFrost.value.set((r.left - pad) * pr, (r.top - pad) * pr, (r.right + pad) * pr, (r.bottom + pad) * pr)
    uFrostOn.value = 1
    const c = glance.querySelector("[data-count]")
    if (c instanceof HTMLElement && c.offsetParent) {
      const cr = c.getBoundingClientRect()
      bannerBox = { c1: Math.round((cr.right * pr) / ov.cell) + 1, r: Math.floor((((cr.top + cr.bottom) / 2) * pr) / ov.cell) }
    } else bannerBox = null
  }

  const updateBeing = (dt: number): void => {
    const b = being
    b.t += dt
    if (b.state === "form" && b.t > b.dur) nextState()
    if ((b.state === "read" || b.state === "dream" || b.state === "rest" || b.state === "bloom") && b.t > b.dur) {
      if (b.state === "bloom") setState("drift")
      else nextState()
    }

    const goal = b.goal.clone()
    goal.y += Math.sin(simTime * 0.9) * 0.05
    goal.x += Math.sin(simTime * 0.37) * 0.08
    const k = b.state === "approach" ? 2.2 : 1.4
    const acc = goal.clone().sub(b.pos).multiplyScalar(k).sub(b.vel.clone().multiplyScalar(1.9))
    b.vel.addScaledVector(acc, dt)
    const sp = b.vel.length()
    if (sp > 0.9) b.vel.multiplyScalar(0.9 / sp)
    b.pos.addScaledVector(b.vel, dt)
    b.pos.z = Math.min(b.pos.z, -0.85)
    const arrived = b.pos.distanceTo(goal) < 0.12 && b.vel.length() < 0.12
    if (b.state === "drift" && arrived) nextState()
    if (b.state === "approach" && b.pos.distanceTo(b.goal) < 0.1) {
      setState("needs")
      b.touchAt = 0.6
    }
    if (b.state === "needs" && totalNeeds() === 0) nextState()
    if (b.state === "approach" || b.state === "needs") aimAtList()

    const glowWant = GLOW[b.state]
    b.glow += (glowWant * (b.state === "needs" ? 1 + 0.12 * Math.sin(simTime * 2.4) : 1) - b.glow) * (1 - Math.exp(-dt * 1.6))
    b.churn += (CHURN[b.state] - b.churn) * (1 - Math.exp(-dt * 2))

    const p = project(b.pos)
    const size = bufferSize()
    const dist = camera.position.distanceTo(b.pos)
    const r = (0.4 / (dist * Math.tan(MathUtils.degToRad(camera.fov / 2)))) * size.y * 0.5
    b.scr = { x: p.x, y: p.y, r }

    const focus = bannerBox ? { markCol: bannerBox.c1 - 2, row: bannerBox.r } : null
    if ((b.state === "approach" || b.state === "needs") && focus) {
      const ax = (focus.markCol + 1) * ov.cell - p.x
      const ay = (focus.row + 0.5) * ov.cell - p.y
      const al = Math.hypot(ax, ay) || 1
      uAttn.value.set(ax / al, ay / al, 0.9)
    } else uAttn.value.set(0, 0, 0)

    uBeing.value.set(b.pos.x, b.pos.y, b.pos.z, b.glow * Math.min(1, uForm.value * 1.4))
    uBeingScr.value.set(p.x, p.y, r, b.glow * uForm.value)
    uChurn.value = b.churn

    b.nextThought -= dt
    if (b.nextThought < 0) {
      const fr = uFrost.value
      const clearOfList = p.y - r * 1.6 > fr.w || p.x - r > fr.z + ov.cell * 2
      if (!clearOfList) b.nextThought = 2
      else if (b.state === "dream") {
        say(pick(THOUGHTS))
        b.nextThought = 2.4 + Math.random() * 1.5
      } else if (b.state === "rest") {
        say("...", { rate: 3, life: 3 })
        b.nextThought = 6 + Math.random() * 3
      } else if (b.state === "drift" && Math.random() < 0.35) {
        say(pick(THOUGHTS))
        b.nextThought = 8 + Math.random() * 6
      } else b.nextThought = 3 + Math.random() * 3
    }

    if (b.state === "read" && b.reading && b.t > 1.2) {
      const f = b.reading
      if (Math.random() < dt * 14) {
        const fp = project(new Vector3(f.x + 0.25 * uWind.value * f.h * 0.6, f.h, f.z))
        emitMote(fp.x + (Math.random() - 0.5) * ov.cell * 2, fp.y + (Math.random() - 0.5) * ov.cell, { ch: pick([".", "e", "/", "+", "*", "=", "2"]), target: true, life: 2.2, morph: true })
      }
    }

    if (Math.random() < dt * (b.state === "rest" ? 0.4 : 1.6) * uForm.value) {
      const a = Math.random() * Math.PI * 2
      emitMote(p.x + Math.cos(a) * r * 0.7, p.y + Math.sin(a) * r * 0.7, { ch: String.fromCharCode(97 + Math.floor(Math.random() * 26)), mode: 1, life: 2.5 + Math.random() * 2 })
    }

    if (b.state === "needs" && focus) {
      b.touchAt -= dt
      if (b.touchAt < 0) {
        b.touchAt = 4
        const g = pointAtDepthPx((focus.markCol + 1) * ov.cell, (focus.row + 0.5) * ov.cell, 0)
        knockAt(g.x, g.y, 0.42)
      }
    }
  }

  const updateOverlay = (dt: number): void => {
    ov.clear()
    const cell = ov.cell
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i]
      if (!w) continue
      const age = simTime - w.t0
      if (age < 0) continue
      const typed = Math.min(w.text.length, Math.floor(age * w.typeRate))
      const dissolve = w.keep ? 0 : clamp((age - w.life) / 1.1, 0, 1)
      if (dissolve >= 1) {
        words.splice(i, 1)
        continue
      }
      w.y -= cell * 0.35 * dt
      w.x += cell * 0.25 * dt * uWind.value
      let str = ""
      for (let c = 0; c < typed; c++) {
        const hsh = Math.abs(Math.sin((c + 1) * 12.9898 + w.t0 * 78.233)) % 1
        if (dissolve > hsh) str += hsh < dissolve - 0.25 ? " " : "."
        else str += w.text[c] ?? ""
      }
      if (typed < w.text.length && Math.floor(age * 4) % 2 === 0) str += "_"
      ov.text(str, w.x, w.y, 0.95 * clamp(age * 4, 0, 1), w.mode)
    }

    const bx = being.scr.x
    const by = being.scr.y
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]
      if (!m) continue
      m.age += dt
      if (m.age > m.life) {
        motes.splice(i, 1)
        continue
      }
      if (m.target) {
        const dx = bx - m.x
        const dy = by - m.y
        const d = Math.hypot(dx, dy)
        const sp = cell * 6
        m.vx += ((dx / (d || 1)) * sp - m.vx) * Math.min(1, dt * 3)
        m.vy += ((dy / (d || 1)) * sp - m.vy) * Math.min(1, dt * 3)
        if (d < being.scr.r * 0.55) {
          motes.splice(i, 1)
          continue
        }
        if (m.morph && d < being.scr.r * 2.2) {
          m.ch = String.fromCharCode(97 + Math.floor(Math.random() * 26))
          m.mode = 1
          m.morph = false
        }
      } else {
        const wv = windPx(m.x, m.y, simTime)
        m.vx += (wv.vx - m.vx) * Math.min(1, dt * 0.9)
        m.vy += (wv.vy - m.vy) * Math.min(1, dt * 0.9)
      }
      m.x += m.vx * dt
      m.y += m.vy * dt
      const fade = Math.min(1, m.age * 3) * Math.min(1, (m.life - m.age) / 0.8)
      ov.putPx(m.x, m.y, m.ch, 0.85 * fade, m.mode)
    }

    if (uForm.value > 0.5 && Math.random() < dt * 2.2 * uWind.value) {
      const f = pick(flowerList)
      if (f.z < -1.2 && f.z > -9) {
        const fp = project(new Vector3(f.x, f.h, f.z))
        if (!fp.behind) emitMote(fp.x, fp.y, { ch: pick(["'", ",", ".", "·", "*"]), mode: f.kind === 0 ? 2 : 0, life: 4 + Math.random() * 3 })
      }
    }
    drawRows()
    ovTex.needsUpdate = true
  }

  const layout = (): void => {
    const w = innerWidth
    const h = innerHeight
    camera.aspect = w / h
    camera.fov = camera.aspect >= 1 ? 40 : Math.min(66, 40 + (1 - camera.aspect) * 40)
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    const pr = renderer.getPixelRatio()
    uCell.value = Math.round((w < 600 ? 12 : 14) * pr)
    ov.cell = uCell.value
    const size = bufferSize()
    ov.cols = Math.ceil(size.x / ov.cell)
    ov.rows = Math.ceil(size.y / ov.cell)
    const rw = Math.ceil(size.x / (uCell.value / 3))
    const rh = Math.ceil(size.y / (uCell.value / 3))
    rtScene.setSize(rw, rh)
    uTexel.value.set(1 / rw, 1 / rh)
  }

  let still = still0
  const updateCamera = (time: number): void => {
    const m = still ? 0 : 1
    camera.position.set(camBase.x + Math.sin(time * 0.11) * 0.03 * m, camBase.y + Math.sin(time * 0.13) * 0.012 * m, camBase.z)
    camera.lookAt(camLook)
    camera.updateMatrixWorld()
    const e = camera.matrixWorld.elements
    uCamPos.value.copy(camera.position)
    uRight.value.set(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0)
    uUp.value.set(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0)
    uFwd.value.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1))
    uTan.value = Math.tan(MathUtils.degToRad(camera.fov / 2))
    uAspect.value = camera.aspect
  }

  const render = (): void => {
    renderer.setRenderTarget(rtScene)
    renderer.setClearColor(hazeClear, 0)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    quadOut.render(renderer)
  }

  let simClock = 0
  let lastNow = 0
  let running = false
  let gone = false

  const frame = (dt: number): void => {
    simClock += dt
    simTime = simClock
    uTime.value = simClock
    uForm.value = Math.min(1, uForm.value + dt / 3.2)
    uWind.value = 0.85 + 0.35 * smooth(clamp(Math.sin(simClock * 0.13) * 0.5 + 0.5, 0, 1))
    uAlert.value += ((totalNeeds() > 0 ? 1 : 0) - uAlert.value) * (1 - Math.exp(-dt * 1.5))
    updateCamera(simClock)
    updateBeing(dt)
    updateOverlay(dt)
    render()
  }

  const loop = (): void => {
    const now = performance.now() / 1000
    const dt = Math.min(1 / 24, Math.max(1 / 240, now - lastNow))
    lastNow = now
    frame(dt)
  }
  const startLoop = (): void => {
    if (gone || running || still || document.hidden) return
    running = true
    lastNow = performance.now() / 1000
    void renderer.setAnimationLoop(loop)
  }
  const stopLoop = (): void => {
    running = false
    void renderer.setAnimationLoop(null)
  }

  const renderStill = (): void => {
    if (gone || !still) return
    words.length = 0
    motes.length = 0
    uForm.value = 1
    drawRows()
    if (totalNeeds() > 0) {
      aimAtList()
      being.pos.copy(being.goal)
      being.state = "needs"
    } else if (being.state === "needs" || being.state === "approach" || being.state === "form") {
      being.pos.set(0.6, 1.0, -2.8)
      being.goal.copy(being.pos)
      being.state = "dream"
    }
    being.vel.set(0, 0, 0)
    being.glow = 1
    uTime.value = 12.0
    uWind.value = 0.9
    uAlert.value = totalNeeds() > 0 ? 1 : 0
    updateCamera(0)
    const saved = simClock
    simTime = 12.0
    updateBeing(0)
    being.pos.copy(being.goal)
    updateBeing(0)
    ov.clear()
    drawRows()
    ovTex.needsUpdate = true
    for (const k of uKnocks) k.value.set(0, 0, -99, 0)
    render()
    simClock = saved
  }

  const onResize = (): void => {
    layout()
    if (still) requestAnimationFrame(renderStill)
  }
  const onVisibility = (): void => {
    if (document.hidden) stopLoop()
    else if (still) renderStill()
    else startLoop()
  }
  addEventListener("resize", onResize)
  document.addEventListener("visibilitychange", onVisibility)

  try {
    await Promise.race([document.fonts.load(`400 60px ${monoFamily}`), new Promise((r) => setTimeout(r, 1500))])
  } catch {
    // A font that doesn't load leaves the system monospace in the glyphs.
  }
  drawAtlas()
  layout()
  updateCamera(0)
  setState("form", 4)
  if (still) renderStill()
  else startLoop()

  return {
    setRows(next) {
      const prevNeeds = totalNeeds()
      rows = next.slice(0, 8).map((r) => ({ ...r }))
      const needs = totalNeeds()
      drawRows()
      if (needs > 0 && being.state !== "approach" && being.state !== "needs") setState("approach")
      else if (needs > 0) aimAtList()
      if (needs === 0 && prevNeeds > 0 && (being.state === "approach" || being.state === "needs")) bloom()
      if (still) requestAnimationFrame(renderStill)
    },
    setStill(next) {
      if (next === still) return
      still = next
      if (still) {
        stopLoop()
        renderStill()
      } else startLoop()
    },
    dispose() {
      gone = true
      stopLoop()
      removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
