import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicNodeMaterial,
  NoBlending,
  NodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PlaneGeometry,
  QuadMesh,
  RenderTarget,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
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
  fract,
  hash,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  mix,
  mx_fractal_noise_float,
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

import { ADVANCE, BASE64, planRun, poseGlyph, runFocus, runGap, type Pose, type Rand, type Run, type Source } from "~/afk/cipher"
import { daylight, type Rgb } from "~/afk/daylight"
import { freshPace, paced, SLOW_HOLD_MS } from "~/afk/pace"

export interface Meadow {
  setClock(at: number): void
  setAlert(on: boolean): void
  setStill(still: boolean): void
  freeze(): void
  dispose(): void
}

interface Engine {
  attach(stage: HTMLElement, still: boolean): Meadow
}

let clockAhead = 0

const clock = (): Date => new Date(Date.now() + clockAhead)

const STILL_EVERY = 60_000
const MAX_GLYPHS = 20
const ATLAS_COLS = 13
const ATLAS_ROWS = 5
const CELL_W = 56
const CELL_H = 72
const SOFT_NEAR = 5.5
const SOFT_FAR = 15

const seeded =
  (s: number): Rand =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647

function glyphAtlas(): CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = ATLAS_COLS * CELL_W
  canvas.height = ATLAS_ROWS * CELL_H * 2
  const g = canvas.getContext("2d")
  if (g) {
    const away = canvas.height * 2
    g.fillStyle = "#fff"
    g.shadowColor = "#fff"
    g.shadowOffsetY = away
    g.font = `600 ${Math.round(CELL_H * 0.5)}px ui-monospace, Menlo, monospace`
    g.textAlign = "center"
    g.textBaseline = "middle"
    for (const [half, soft] of [SOFT_NEAR, SOFT_FAR].entries()) {
      g.shadowBlur = soft
      for (let i = 0; i < BASE64.length; i++) g.fillText(BASE64.charAt(i), ((i % ATLAS_COLS) + 0.5) * CELL_W, (Math.floor(i / ATLAS_COLS) + half * ATLAS_ROWS + 0.55) * CELL_H - away)
    }
  }
  return new CanvasTexture(canvas)
}

let engine: Promise<Engine | null> | null = null

export async function startMeadow(stage: HTMLElement, still: boolean): Promise<Meadow | null> {
  engine ??= build()
  const e = await engine
  return e ? e.attach(stage, still) : null
}

const skyDir = (x: number, y: number, out: Vector3): Vector3 => {
  const az = x * 0.5
  const el = -0.06 + y * 0.36
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
}

const smooth01 = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

async function build(): Promise<Engine | null> {
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

  const scene = new Scene()
  const camera = new PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 120)
  const camBase = new Vector3(0, 0.5, 1.3)
  const camLook = new Vector3(0, 0.92, -6)

  const C = {
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
    decide: color(0xf5b041),
    moon: vec3(0.93, 0.94, 0.98),
  }

  const uTime = uniform(0)
  const uWind = uniform(1)
  const uTexel = uniform(new Vector2(1 / 300, 1 / 200))
  const uRight = uniform(new Vector3(1, 0, 0))
  const uUp = uniform(new Vector3(0, 1, 0))
  const uFwd = uniform(new Vector3(0, 0, -1))
  const uTan = uniform(0.3)
  const uAspect = uniform(1.6)
  const uAlert = uniform(0)
  const uTop = uniform(new Vector3())
  const uLow = uniform(new Vector3())
  const uHaze = uniform(new Vector3())
  const uLight = uniform(new Vector3(1, 1, 1))
  const uCloud = uniform(new Vector3())
  const uGlow = uniform(new Vector3())
  const uSunDir = uniform(new Vector3(0, 0.2, -1))
  const uSunShow = uniform(1)
  const uMoonDir = uniform(new Vector3(0, 0.2, -1))
  const uMoonShow = uniform(0)
  const uMoonFull = uniform(0)
  const uStars = uniform(0)
  const uNight = uniform(0)

  const windLean = (xz: Node<"vec2">, seed: Node<"float">) => {
    const t = uTime
    const base = sin(t.mul(0.8).add(xz.x.mul(0.4)).add(xz.y.mul(0.25)).add(seed.mul(1.3))).mul(0.22)
    const wave = sin(xz.x.mul(0.3).add(xz.y.mul(0.12)).sub(t.mul(1.1)))
      .mul(0.5)
      .add(0.5)
    const gust = smoothstep(0.45, 1.0, wave).mul(0.75)
    const flutter = sin(t.mul(3.1).add(seed.mul(17.0))).mul(0.05)
    const w = base.add(gust).add(flutter).add(0.18).mul(uWind)
    return vec2(w.mul(0.3), w.mul(-0.05))
  }

  const fogOf = (wp: Node<"vec3">) => smoothstep(5.0, 26.0, cameraPosition.distance(wp))
  const lit = (col: Node<"vec3">, wp: Node<"vec3">, fog: number) => mix(col.mul(uLight), uHaze, fogOf(wp).mul(fog))
  const eligible = (e: Node<"float">) => float(0.2).add(e.clamp(0, 1).mul(0.8))

  const rtMaterial = <M extends MeshBasicNodeMaterial | SpriteNodeMaterial>(m: M): M => {
    m.transparent = true
    m.blending = NoBlending
    m.depthWrite = true
    m.depthTest = true
    m.side = DoubleSide
    return m
  }

  let seed = 7
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const FG = small ? 10 : 18
  const FLOWERS = (small ? 700 : 1100) + FG
  const GRASS = small ? 4500 : 8000

  {
    const g = new PlaneGeometry(240, 240)
    g.rotateX(-Math.PI / 2)
    const m = rtMaterial(new MeshBasicNodeMaterial())
    m.colorNode = Fn(() => {
      const wp = positionWorld
      const n = mx_fractal_noise_float(vec3(wp.xz.mul(0.35), 1.0), 3, 2.0, 0.5)
        .mul(0.5)
        .add(0.5)
      const col = vec3(mix(C.groundNear, C.groundFar, smoothstep(2.0, 18.0, cameraPosition.distance(wp))).mul(n.mul(0.35).add(0.8)))
      return lit(col, wp, 0.9)
    })()
    m.opacityNode = eligible(float(0))
    const mesh = new Mesh(g, m)
    mesh.position.z = -60
    scene.add(mesh)
  }

  const fData = new Float32Array(FLOWERS * 4)
  const fKind = new Float32Array(FLOWERS * 4)
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
  }
  const fDataAttr = new InstancedBufferAttribute(fData, 4)
  const fKindAttr = new InstancedBufferAttribute(fKind, 4)

  {
    const g = new PlaneGeometry(1, 1, 1, 6)
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
    m.colorNode = Fn(() => lit(vec3(mix(C.stem, C.stemLight, f.mul(0.7).add(abs(positionGeometry.x).oneMinus().mul(0.2)))), positionWorld, 0.85))()
    m.opacityNode = eligible(smoothstep(15.0, 6.0, cameraPosition.distance(positionWorld)).mul(0.9))
    const mesh = new InstancedMesh(g, m, FLOWERS)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  {
    const g = new PlaneGeometry(1, 1, 1, 5)
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
      return lit(vec3(mix(C.stem, C.stemLight, p.y.mul(0.6).add(abs(p.x.sub(0.5)).mul(0.6)))), positionWorld, 0.85)
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
        const shine = smoothstep(0.02, 0.22, p.y)
          .mul(0.6)
          .add(smoothstep(0.05, -0.25, p.x).mul(0.25))
        out.assign(mix(body, C.cream, shine.clamp(0, 0.85)))
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
      return lit(out, positionWorld, 0.8)
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
    const g = new PlaneGeometry(1, 1, 1, 3)
    const m = rtMaterial(new MeshBasicNodeMaterial())
    const inst = instancedBufferAttribute<"vec4">(attr)
    const f = positionGeometry.y.add(0.5)
    const lean = windLean(inst.xy, inst.w).mul(1.5)
    const bend = f.mul(f)
    m.positionNode = vec3(inst.x.add(positionGeometry.x.mul(0.03).mul(f.oneMinus())).add(lean.x.mul(bend).mul(inst.z)), f.mul(inst.z), inst.y.add(lean.y.mul(bend).mul(inst.z)))
    m.colorNode = Fn(() => lit(vec3(mix(C.grass, C.grassTip, f.mul(0.8).add(inst.w.mul(0.2)))), positionWorld, 0.85))()
    m.opacityNode = eligible(smoothstep(9.0, 3.5, cameraPosition.distance(positionWorld)).mul(0.32))
    const mesh = new InstancedMesh(g, m, GRASS)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  const outScene = new Scene()
  const airLit = (tint: Node<"vec3">, wp: Node<"vec3">) => {
    const view = normalize(wp.sub(cameraPosition))
    const sun = pow(view.dot(uSunDir).max(0), 5.0).mul(uSunShow)
    const moon = pow(view.dot(uMoonDir).max(0), 8.0).mul(uMoonShow)
    const col = tint
      .mul(uLight)
      .mul(uNight.mul(0.45).add(1.0))
      .add(uGlow.mul(sun.mul(0.45).add(0.12)))
      .add(C.moon.mul(moon.mul(0.12)))
    const hazed = mix(col, uHaze, fogOf(wp).mul(0.75))
    return mix(hazed, hazed.mul(vec3(1.05, 0.98, 0.86)).add(vec3(0.02, 0.012, 0.0)), uAlert.mul(0.75))
  }
  const airMaterial = (): SpriteNodeMaterial => {
    const m = new SpriteNodeMaterial()
    m.transparent = true
    m.blending = AdditiveBlending
    m.depthTest = false
    m.depthWrite = false
    return m
  }

  {
    const P = small ? 22 : 36
    const a = new Float32Array(P * 4)
    const b = new Float32Array(P * 4)
    for (let i = 0; i < P; i++) {
      const d = 1.6 + 6 * Math.pow(rand(), 1.3)
      a.set([rand(), 0.5 + d * (rand() * 0.42 - 0.2), 1.3 - d, rand()], i * 4)
      b.set([0.03 + rand() * 0.03 + Math.max(0, 2.6 - d) * 0.03, 0.03 + rand() * 0.05, 0.1 + rand() * 0.14, rand()], i * 4)
    }
    const p = instancedBufferAttribute<"vec4">(new InstancedBufferAttribute(a, 4))
    const q = instancedBufferAttribute<"vec4">(new InstancedBufferAttribute(b, 4))
    const span = float(1.3).sub(p.z).mul(0.9).add(0.3)
    const f = fract(p.x.add(uTime.mul(q.y).div(span.mul(2))))
    const wp = vec3(
      f.mul(2).sub(1).mul(span),
      p.y.add(sin(uTime.mul(0.37).add(p.w.mul(6.283))).mul(0.05)).add(sin(uTime.mul(0.93).add(p.w.mul(17.0))).mul(0.015)),
      p.z.add(sin(uTime.mul(0.21).add(p.w.mul(11.0))).mul(0.12))
    )
    const m = airMaterial()
    m.positionNode = wp
    m.scaleNode = q.x
    m.colorNode = airLit(mix(C.cream, C.yolk, q.w.mul(0.5).add(0.2)), wp)
    const c = uv().sub(0.5)
    m.opacityNode = exp(c.dot(c).mul(-22.0))
      .mul(q.z)
      .mul(smoothstep(0.0, 0.08, f))
      .mul(smoothstep(1.0, 0.92, f))
    const pollen = new Sprite(m)
    pollen.count = P
    pollen.frustumCulled = false
    outScene.add(pollen)
  }

  const gPos = new Float32Array(MAX_GLYPHS * 4)
  const gChar = new Float32Array(MAX_GLYPHS * 4)
  const gTint = new Float32Array(MAX_GLYPHS * 4)
  const gLens = new Float32Array(MAX_GLYPHS * 4)
  const gPosAttr = new InstancedBufferAttribute(gPos, 4)
  const gCharAttr = new InstancedBufferAttribute(gChar, 4)
  const gTintAttr = new InstancedBufferAttribute(gTint, 4)
  const gLensAttr = new InstancedBufferAttribute(gLens, 4)
  const glyphs = (() => {
    const atlas = glyphAtlas()
    const pos = instancedDynamicBufferAttribute<"vec4">(gPosAttr)
    const ch = instancedDynamicBufferAttribute<"vec4">(gCharAttr)
    const tint = instancedDynamicBufferAttribute<"vec4">(gTintAttr)
    const lens = instancedDynamicBufferAttribute<"vec4">(gLensAttr)
    const rows = ATLAS_ROWS * 2
    const cell = (i: Node<"float">, half: number) => {
      const idx = floor(i.add(0.5))
      const row = floor(idx.add(0.5).div(ATLAS_COLS))
      return vec2(
        idx.sub(row.mul(ATLAS_COLS)).add(uv().x).div(ATLAS_COLS),
        float(rows - 1 - half * ATLAS_ROWS)
          .sub(row)
          .add(uv().y)
          .div(rows)
      )
    }
    const pair = (half: number, b: Node<"float">) => mix(texture(atlas, cell(ch.x, half)).bias(b).a, texture(atlas, cell(ch.y, half)).bias(b).a, ch.z)
    const p = uv()
      .sub(0.5)
      .mul(vec2(CELL_W / CELL_H, 1))
    const edge = smoothstep(0.5, 0.38, abs(uv().x.sub(0.5))).mul(smoothstep(0.5, 0.4, abs(uv().y.sub(0.5))))
    const shape = smoothstep(0.1, 0.8, ch.w)
    const soft = lens.x.add(ch.w.oneMinus().mul(3.0))
    const body = mix(pair(1, soft), pair(0, soft), lens.z).mul(edge).mul(shape).mul(tint.w)
    const glow = mix(exp(p.dot(p).mul(-55.0)).mul(0.7), pair(1, soft.add(1.2)).mul(edge), shape).mul(tint.w)
    const lit = airLit(tint.rgb, pos.xyz)
    const m = new SpriteNodeMaterial()
    m.transparent = true
    m.blending = CustomBlending
    m.blendSrc = OneFactor
    m.blendDst = OneMinusSrcAlphaFactor
    m.depthTest = false
    m.depthWrite = false
    m.positionNode = pos.xyz
    m.scaleNode = vec2(pos.w.mul(CELL_W / CELL_H), pos.w)
    m.rotationNode = lens.y
    m.colorNode = lit.mul(body.mul(mix(0.34, 1.35, uNight)).add(glow.mul(mix(0.35, 0.7, uNight))))
    m.opacityNode = body.mul(mix(1.35, 0.3, uNight))
    const s = new Sprite(m)
    s.count = MAX_GLYPHS
    s.frustumCulled = false
    outScene.add(s)
    return s
  })()

  const rayDir = (suv: Node<"vec2">) => normalize(uFwd.add(uRight.mul(suv.x.mul(2).sub(1).mul(uTan).mul(uAspect))).add(uUp.mul(suv.y.mul(-2).add(1).mul(uTan))))

  {
    const m = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, depthTest: false })
    m.blending = NoBlending
    m.colorNode = Fn(() => {
      const suv = screenUV
      const rd = rayDir(suv).toVar()
      const col = mix(mix(uHaze, uLow, smoothstep(-0.02, 0.12, rd.y)), uTop, smoothstep(0.1, 0.5, rd.y)).toVar()
      const sunSide = pow(rd.dot(uSunDir).max(0), 6.0).mul(uSunShow)
      col.assign(mix(col, uGlow, sunSide.mul(0.55)))
      const drift = uTime.mul(0.012).mul(uWind)
      const cn = mx_fractal_noise_float(vec3(suv.x.mul(uAspect).mul(1.3).sub(drift), suv.y.mul(2.2), uTime.mul(0.015)), 3, 2.0, 0.5)
        .mul(0.5)
        .add(0.5)
      const clouds = smoothstep(0.52, 0.78, cn).mul(smoothstep(0.65, 0.1, suv.y))
      const cloudCol = mix(uCloud, uGlow, sunSide.mul(0.6))
      col.assign(mix(col, cloudCol, clouds.mul(mix(0.7, 0.45, uNight))))
      return col
    })()
    m.opacityNode = float(0)
    const dome = new Mesh(new SphereGeometry(100, 24, 12), m)
    dome.renderOrder = -100
    dome.frustumCulled = false
    scene.add(dome)
  }

  const hazeClear = new Color(0xe8e4dc)
  const rtScene = new RenderTarget(300, 200, { type: HalfFloatType, depthBuffer: true })
  const rtBlur = new RenderTarget(300, 200, { type: HalfFloatType, depthBuffer: false })

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
  const matBlur = new NodeMaterial()
  matBlur.fragmentNode = Fn(() => sceneBlur(screenUV, uTexel.mul(1.7)))()
  const quadBlur = new QuadMesh(matBlur)

  const matOut = new NodeMaterial()
  matOut.fragmentNode = Fn(() => {
    const suv = screenUV
    const pix = suv.mul(screenSize)
    const sb = texture(rtBlur.texture, suv)
    const sky = smoothstep(0.15, 0.0, sb.a)
    const col = sb.rgb.toVar()
    const rd = rayDir(suv).toVar()

    const ds = rd.dot(uSunDir).max(0)
    const sunLight = pow(ds, 40.0).mul(0.28).add(pow(ds, 6.0).mul(0.12))
    col.addAssign(uGlow.mul(sunLight.mul(mix(0.55, 1.0, sky))).mul(uSunShow))

    const dm = rd.dot(uMoonDir).max(0)
    const moonLight = pow(dm, 60.0).mul(0.2).add(pow(dm, 8.0).mul(0.06))
    col.addAssign(
      C.moon.mul(
        moonLight
          .mul(mix(0.25, 1.0, uMoonFull))
          .mul(mix(0.5, 1.0, sky))
          .mul(uMoonShow)
      )
    )

    If(uStars.greaterThan(0.01), () => {
      const st = vec2(atan(rd.x, rd.z.negate()), rd.y).mul(150.0)
      const cid = floor(st)
      const h = hash(cid.x.mul(12.9898).add(cid.y.mul(78.233)))
      const off = vec2(hash(cid.x.add(cid.y.mul(31.7))), hash(cid.y.add(cid.x.mul(17.3))))
        .mul(0.6)
        .add(0.2)
      const d = fract(st).sub(off).length()
      const twinkle = sin(uTime.mul(h.mul(3.0).add(1.0)).add(h.mul(90.0)))
        .mul(0.35)
        .add(0.65)
      const star = smoothstep(0.16, 0.0, d)
        .mul(step(0.982, h))
        .mul(twinkle)
        .mul(smoothstep(0.02, 0.12, rd.y))
      col.addAssign(vec3(0.9, 0.93, 1.0).mul(star.mul(sky).mul(uStars)))
    })

    col.assign(mix(col, col.mul(vec3(1.05, 0.98, 0.86)).add(vec3(0.02, 0.012, 0.0)), uAlert.mul(0.75)))

    const vig = smoothstep(1.25, 0.45, suv.sub(0.5).mul(vec2(uAspect, 1.0)).length())
    col.assign(col.mul(vig.mul(0.08).add(0.92)))
    col.assign(mix(col, C.decide, vig.oneMinus().mul(uAlert).mul(0.22)))
    const grain = hash(pix.x.floor().add(pix.y.floor().mul(1931.0)).add(uTime.mul(61.0).fract().mul(7919.0)))
      .sub(0.5)
      .mul(0.012)
    return vec4(col.add(grain), 1.0)
  })()
  matOut.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0)
  matOut.depthTest = false
  matOut.depthWrite = false
  matOut.side = DoubleSide
  const quadOut = new Mesh(new PlaneGeometry(2, 2), matOut)
  quadOut.frustumCulled = false
  quadOut.renderOrder = -1
  outScene.add(quadOut)

  let host: HTMLElement | null = null
  let alert = 0
  let still = false
  let asked = false
  let slow = false
  let slowUntil = 0
  let pace = freshPace()
  let attached = false
  let running = false
  let simClock = 0
  let lastNow = 0
  let stillTimer = 0
  const scratch = new Vector3()
  const aimDir = new Vector3()
  const aimFwd = new Vector3()

  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const setRgb = (u: { value: Vector3 }, c: Rgb): void => {
    u.value.set(linear(c[0]), linear(c[1]), linear(c[2]))
  }

  const updateSky = (at: Date): void => {
    const d = daylight(at)
    setRgb(uTop, d.look.top)
    setRgb(uLow, d.look.low)
    setRgb(uHaze, d.look.haze)
    setRgb(uLight, d.look.light)
    setRgb(uCloud, d.look.cloud)
    setRgb(uGlow, d.look.glow)
    hazeClear.setRGB(linear(d.look.haze[0]), linear(d.look.haze[1]), linear(d.look.haze[2]))
    uSunDir.value.copy(skyDir(d.sun.x, d.sun.y, scratch))
    uSunShow.value = d.sun.show
    uMoonDir.value.copy(skyDir(d.moon.x, d.moon.y, scratch))
    uMoonShow.value = d.moon.show
    uMoonFull.value = (1 - Math.cos(2 * Math.PI * d.moon.phase)) / 2
    uStars.value = d.stars
    uNight.value = d.night
  }

  const layout = (): void => {
    const w = innerWidth
    const h = innerHeight
    camera.aspect = w / h
    camera.fov = camera.aspect >= 1 ? 40 : Math.min(66, 40 + (1 - camera.aspect) * 40)
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    const pr = renderer.getPixelRatio()
    const cell = Math.round((w < 600 ? 12 : 14) * pr) / 3
    const size = renderer.getDrawingBufferSize(new Vector2())
    const rw = Math.ceil(size.x / cell)
    const rh = Math.ceil(size.y / cell)
    rtScene.setSize(rw, rh)
    rtBlur.setSize(rw, rh)
    uTexel.value.set(1 / rw, 1 / rh)
  }

  const updateCamera = (time: number): void => {
    const m = still ? 0 : 1
    camera.position.set(camBase.x + Math.sin(time * 0.11) * 0.03 * m, camBase.y + Math.sin(time * 0.13) * 0.012 * m, camBase.z)
    camera.lookAt(camLook)
    camera.updateMatrixWorld()
    const e = camera.matrixWorld.elements
    uRight.value.set(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0)
    uUp.value.set(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0)
    uFwd.value.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1))
    uTan.value = Math.tan(MathUtils.degToRad(camera.fov / 2))
    uAspect.value = camera.aspect
  }

  interface Flight {
    run: Run
    at: number
    x: number
    y: number
    z: number
    h: number
    vx: number
    vy: number
    blur: number
    peak: number
    tints: [Color, Color]
    phase: number
  }

  const POLLEN_TINTS = [new Color(0xfff5e6).lerp(new Color(0xf2b63c), 0.4), new Color(0xfff5e6).lerp(new Color(0xf2b63c), 0.65)]
  const pose: Pose = { x: 0, y: 0, z: 0, a: 0, b: 0, mix: 0, form: 0, alpha: 0 }
  const tone = new Color()
  let flight: Flight | null = null
  let nextRun = 3 + Math.random() * 9

  const launch = (r: Rand, at: number, source: Source): Flight => {
    const run = planRun(r, source)
    const n = run.glyphs.length
    const depth = 2.6 + r() * 2.6
    const span = 0.12 + r() * 0.06
    const hs = Math.max(0.045, Math.min(0.075, (span * camera.aspect) / (n * ADVANCE)))
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2))
    const h = hs * 2 * tan * depth
    const w = (n * ADVANCE * hs) / camera.aspect
    const sx = 0.12 + w / 2 + r() * Math.max(0, 0.76 - w)
    const sy = Math.min(sx < 0.55 ? 0.54 : 0.68, (source === "air" ? 0.48 : 0.54) + r() * 0.14)
    aimDir
      .set(sx * 2 - 1, 1 - sy * 2, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize()
    camera.getWorldDirection(aimFwd)
    const reach = depth / Math.max(0.1, aimDir.dot(aimFwd))
    const pick = (): Color => POLLEN_TINTS[Math.floor(r() * POLLEN_TINTS.length)] ?? tone
    return {
      run,
      at,
      x: camera.position.x + aimDir.x * reach,
      y: camera.position.y + aimDir.y * reach,
      z: camera.position.z + aimDir.z * reach,
      h,
      vx: 0.035 + r() * 0.03,
      vy: (r() - 0.5) * 0.01,
      blur: 0.4 + Math.abs(depth - 3.4) * 0.35,
      peak: 0.55,
      tints: [pick(), pick()],
      phase: r() * Math.PI * 2,
    }
  }

  const drawFlight = (f: Flight, t: number, fade: number): void => {
    const local = t - f.at
    const gs = f.run.glyphs
    const focus = runFocus(f.run, local)
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i]
      if (!g) continue
      poseGlyph(g, local, pose)
      const o = i * 4
      const wave = Math.sin(local * 1.3 - i * 0.6 + f.phase)
      tone.copy(f.tints[0]).lerp(f.tints[1], g.tint)
      gPos.set([f.x + pose.x * f.h + f.vx * local, f.y + pose.y * f.h + f.vy * local + wave * 0.12 * f.h, f.z + pose.z * f.h, f.h * g.scale], o)
      gChar.set([pose.a, pose.b, pose.mix, pose.form], o)
      gTint.set([tone.r, tone.g, tone.b, pose.alpha * f.peak * g.ink * fade], o)
      gLens.set([f.blur, g.rot + wave * 0.06, focus, 0], o)
    }
    gPosAttr.needsUpdate = true
    gCharAttr.needsUpdate = true
    gTintAttr.needsUpdate = true
    gLensAttr.needsUpdate = true
    glyphs.count = gs.length
    glyphs.visible = true
  }

  const cipherStep = (): void => {
    if (flight && simClock - flight.at > flight.run.end) flight = null
    if (!flight && simClock >= nextRun) {
      flight = launch(Math.random, simClock, Math.random() < 0.6 ? "air" : "bloom")
      nextRun = simClock + runGap(Math.random)
    }
    if (flight) drawFlight(flight, simClock, 1)
    else glyphs.visible = false
  }

  const cipherStill = (): void => {
    const trace = launch(seeded(55555), 0, "air")
    drawFlight(trace, (trace.run.glyphs[0]?.leave ?? 0) + 0.3, 1)
  }

  const render = (): void => {
    renderer.setRenderTarget(rtScene)
    renderer.setClearColor(hazeClear, 0)
    renderer.render(scene, camera)
    renderer.setRenderTarget(rtBlur)
    quadBlur.render(renderer)
    renderer.setRenderTarget(null)
    renderer.render(outScene, camera)
  }

  const frame = (dt: number): void => {
    simClock += dt
    uTime.value = simClock
    uWind.value = 0.85 + 0.35 * smooth01(Math.sin(simClock * 0.13) * 0.5 + 0.5)
    uAlert.value += (alert - uAlert.value) * (1 - Math.exp(-dt * 1.5))
    updateSky(clock())
    updateCamera(simClock)
    cipherStep()
    render()
  }

  const mark = (): void => {
    renderer.domElement.dataset.meadow = slow ? "slow" : still ? "still" : "moving"
  }

  const govern = (raw: number): void => {
    if (paced(pace, raw) !== "slow") return
    slow = true
    slowUntil = Date.now() + SLOW_HOLD_MS
    still = true
    stopLoop()
    settleStill()
  }

  const loop = (): void => {
    const now = performance.now() / 1000
    const raw = now - lastNow
    lastNow = now
    frame(Math.min(1 / 24, Math.max(1 / 240, raw)))
    govern(raw)
  }
  const startLoop = (): void => {
    if (!attached || frozen || running || still || document.hidden) return
    running = true
    lastNow = performance.now() / 1000
    mark()
    void renderer.setAnimationLoop(loop)
  }
  const stopLoop = (): void => {
    running = false
    void renderer.setAnimationLoop(null)
  }

  const renderStill = (): void => {
    if (!attached || frozen || !still) return
    mark()
    uTime.value = 12.0
    uWind.value = 0.9
    uAlert.value = alert
    updateSky(clock())
    updateCamera(0)
    cipherStill()
    render()
  }

  let settling = 0
  let frozen = false
  const settleStill = (): void => {
    const first = settling === 0
    settling = 3
    if (!first) return
    const go = (): void => {
      renderStill()
      settling--
      if (settling > 0 && attached && !frozen && still) requestAnimationFrame(go)
      else settling = 0
    }
    requestAnimationFrame(go)
  }

  const onResize = (): void => {
    layout()
    if (still) settleStill()
  }
  const onVisibility = (): void => {
    if (document.hidden) {
      stopLoop()
      pace = freshPace()
    } else if (still) settleStill()
    else startLoop()
  }

  const detach = (): void => {
    attached = false
    stopLoop()
    window.clearInterval(stillTimer)
    removeEventListener("resize", onResize)
    document.removeEventListener("visibilitychange", onVisibility)
    renderer.domElement.remove()
    host = null
  }

  try {
    renderer.setRenderTarget(rtScene)
    await renderer.compileAsync(scene, camera)
    renderer.setRenderTarget(rtBlur)
    await renderer.compileAsync(quadBlur, quadBlur.camera)
    renderer.setRenderTarget(null)
    await renderer.compileAsync(outScene, camera)
  } catch {
    // Compiling ahead only saves the first frames; drawing compiles whatever is left.
  }
  glyphs.visible = false

  return {
    attach(stage, still0) {
      if (attached) detach()
      host = stage
      asked = still0
      clockAhead = 0
      if (slow && Date.now() >= slowUntil) {
        slow = false
        pace = freshPace()
      }
      still = asked || slow
      attached = true
      frozen = false
      alert = 0
      stage.appendChild(renderer.domElement)
      addEventListener("resize", onResize)
      document.addEventListener("visibilitychange", onVisibility)
      stillTimer = window.setInterval(renderStill, STILL_EVERY)
      layout()
      updateCamera(simClock)
      if (still) settleStill()
      else startLoop()
      return {
        setClock(at) {
          if (host !== stage) return
          clockAhead = Number.isFinite(at) ? at - Date.now() : 0
          if (still) settleStill()
        },
        setAlert(on) {
          if (host !== stage) return
          alert = on ? 1 : 0
          if (still) settleStill()
        },
        setStill(next) {
          if (host !== stage || next === asked) return
          asked = next
          if (slow || still === next) return
          still = next
          if (still) {
            stopLoop()
            settleStill()
          } else startLoop()
        },
        freeze() {
          if (host !== stage) return
          frozen = true
          stopLoop()
        },
        dispose() {
          if (host === stage) detach()
        },
      }
    },
  }
}
