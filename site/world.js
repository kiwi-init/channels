const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uFlash;
uniform float uBand;
uniform float uPx;

const vec3 B = vec3(1.22, 0.47, 0.045);
const float R = 0.012;
const float FOCAL = 3.4;
const float SCALE = 0.95;

vec3 bump3y(vec3 x, vec3 y) { return clamp(1.0 - x * x - y, 0.0, 1.0); }
vec3 spectral(float x) {
  const vec3 c1 = vec3(3.54585104, 2.93225262, 2.41593945);
  const vec3 x1 = vec3(0.69549072, 0.49228336, 0.27699880);
  const vec3 y1 = vec3(0.02312639, 0.15225084, 0.52607955);
  const vec3 c2 = vec3(3.90307140, 3.21182957, 3.96587128);
  const vec3 x2 = vec3(0.11748627, 0.86755042, 0.66077860);
  const vec3 y2 = vec3(0.84897130, 0.88445281, 0.73949448);
  return bump3y(c1 * (x - x1), y1) + bump3y(c2 * (x - x2), y2);
}

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 pose() { return rotZ(0.4) * rotY(-0.44) * rotX(0.34); }
vec3 center(int k) { float f = float(k) - 1.0; return vec3(-0.5 * f, -0.56 * f, 0.62 * f); }
float sdBox(vec3 p) { vec3 q = abs(p) - B + R; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - R; }
vec3 local(vec3 p, int k, mat3 m) { return m * (p - center(k)); }
float map(vec3 p, mat3 m, out int id) {
  float d = 1e9;
  id = -1;
  for (int k = 0; k < 3; k++) { float e = sdBox(local(p, k, m)); if (e < d) { d = e; id = k; } }
  return d;
}
float mapOne(vec3 p, mat3 m, int k) { return sdBox(local(p, k, m)); }
vec3 normalOf(vec3 p, mat3 m, int k) {
  vec2 e = vec2(0.00035, -0.00035);
  return normalize(e.xyy * mapOne(p + e.xyy, m, k) + e.yyx * mapOne(p + e.yyx, m, k) + e.yxy * mapOne(p + e.yxy, m, k) + e.xxx * mapOne(p + e.xxx, m, k));
}

const vec3 NB = normalize(vec3(0.93, -0.3, 0.2));
vec3 band(vec3 p, float spread, out float mask) {
  float s = dot(p, NB) - uBand;
  float x = s / (0.24 * (1.0 + spread));
  mask = exp(-x * x * 1.6) * step(abs(x), 1.6);
  vec3 c = spectral(clamp(0.5 - 0.42 * x, 0.0, 1.0)) * mask;
  float sheen = exp(-pow((x - 1.15) * 7.0, 2.0));
  return (c * 0.85 + vec3(sheen) * 0.6) * (0.4 + 0.85 * uFlash);
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y / SCALE;
  vec3 ro = vec3(0.0, -0.08, 12.6);
  vec3 rd = normalize(vec3(q, -FOCAL));
  mat3 m = pose();
  float px = 12.6 / (FOCAL * uRes.y) / SCALE;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float t = 9.0;
  bool any = false;
  for (int layer = 0; layer < 4; layer++) {
    int id = -1;
    bool hit = false;
    for (int i = 0; i < 128; i++) {
      float d = map(ro + rd * t, m, id);
      if (d < 0.00012) { hit = true; break; }
      t += d * 0.9;
      if (t > 17.0) break;
    }
    if (!hit) break;
    any = true;
    vec3 pp = ro + rd * t;
    vec3 n = normalOf(pp, m, id);
    vec3 lp = local(pp, id, m);
    vec3 e = B - abs(lp);
    float lo = min(e.x, min(e.y, e.z));
    float hi = max(e.x, max(e.y, e.z));
    float edge = e.x + e.y + e.z - lo - hi;
    float t0 = t;
    for (int i = 0; i < 40; i++) { float d = mapOne(ro + rd * t, m, id); if (d > 0.0) break; t += max(-d, 0.003); }
    float L = t - t0;
    vec3 mid = ro + rd * (t0 + 0.5 * L);
    float cosi = abs(dot(n, -rd));
    float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    float onFace = 1.0 - smoothstep(0.004, 0.012, e.z);
    float css = px * uPx;
    float rimLine = 1.0 - smoothstep(0.0045 + 0.25 * css, 0.0045 + 1.15 * css, edge);
    float rimGlow = exp(-max(edge - 0.0045, 0.0) / (3.0 * css)) * 0.09;
    float lipD = abs(min(e.x, e.y) - 0.07);
    float lip = (1.0 - smoothstep(0.2 * css, 0.9 * css, lipD)) * onFace * 0.2;
    float corner = length(vec2(lo, edge));
    float glint = exp(-corner / (2.2 * css)) * 0.55;
    float bm;
    vec3 light = band(mid, L * 3.0, bm);
    vec3 rimCol = mix(vec3(0.93, 0.94, 0.96), light * 1.6 + 0.3, clamp(bm, 0.0, 1.0) * 0.8);
    vec3 rf = reflect(rd, n);
    float sheen = smoothstep(0.72, 0.98, dot(rf, normalize(vec3(-0.4, 0.8, 0.45)))) * onFace * 0.05;
    vec3 c = light * (0.38 + 0.8 * fres + 2.4 * L) + rimCol * (rimLine * 1.2 + rimGlow + lip + glint) + vec3(fres) * 0.06 + vec3(sheen);
    col += trans * c;
    trans *= 0.62;
    t += 0.004;
  }
  if (!any) { gl_FragColor = vec4(0.0); return; }
  col = col / (1.0 + 0.3 * col);
  gl_FragColor = vec4(col, 1.0 - trans * 0.75);
}
`;

const SCRIPT = [
  [0, "Ship it once the tests pass."],
  [1, "@win can you take T10?"],
  [2, "On it. Down from 6 rows to 4."],
  [3, "Reviewing #41 now."],
  [1, "Approved. Merging."],
  [4, "Nice. I'll tell the team."],
  [5, "Docs updated for the new flow."],
];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PERIOD = 3.6;
const WIDE = [
  [0.22, 0.79, "start"],
  [0.43, 0.6, "end"],
  [0.9, 0.62, "end"],
  [0.74, 0.9, "start"],
  [0.88, 0.27, "end"],
  [0.62, 0.19, "start"],
];
const TALL = [
  [0.1, 0.44, "start"],
  [0.1, 0.2, "start"],
  [0.84, 0.44, "end"],
  [0.5, 0.56, "mid"],
  [0.84, 0.2, "end"],
  [0.5, 0.09, "mid"],
];

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

function glassRenderer(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
  if (!gl) return null;
  try {
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ["uRes", "uFlash", "uBand", "uPx"]) U[n] = gl.getUniformLocation(program, n);
    return (flash, perCss) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uFlash, flash);
      gl.uniform1f(U.uBand, 0.06);
      gl.uniform1f(U.uPx, perCss);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  } catch {
    // A GPU that can't build the shader shows the room without the glass instead of a broken canvas.
    return null;
  }
}

function start(hero, field, glass, members) {
  const ctx = field.getContext("2d");
  if (!ctx) return;
  const renderGlass = glassRenderer(glass);
  if (!renderGlass) hero.classList.add("static");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let tau = 7 * PERIOD + 1.55;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  let glassScale = dpr * 1.5;
  let lastFlash = -1;
  let frame = 0;
  let visible = true;
  let last = 0;
  const captions = members.map((li) => li.querySelector(".said"));
  const shown = members.map(() => "");

  const geo = () => {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    const wide = w / h >= 1.15;
    const gx = w * (wide ? 0.68 : 0.5);
    const gy = h * (wide ? 0.56 : 0.32);
    const gh = h * (wide ? 0.46 : 0.19);
    const spots = wide ? WIDE : TALL;
    const nodes = spots.map(([x, y]) => [x * w, y * h]);
    return { w, h, wide, gx, gy, gh, gw: gh * 1.3, nodes, sides: spots.map((n) => n[2]) };
  };

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const G = geo();
    field.width = Math.round(G.w * dpr);
    field.height = Math.round(G.h * dpr);
    glass.style.width = `${G.gw}px`;
    glass.style.height = `${G.gh}px`;
    glass.style.left = `${G.gx - G.gw / 2}px`;
    glass.style.top = `${G.gy - G.gh / 2}px`;
    glassScale = Math.min(dpr * 1.5, 2600 / G.gw);
    glass.width = Math.round(G.gw * glassScale);
    glass.height = Math.round(G.gh * glassScale);
    lastFlash = -1;
    hero.classList.toggle("tall", !G.wide);
    members.forEach((li, i) => {
      const [x, y] = G.nodes[i];
      li.style.transform = `translate(${x}px, ${y}px)`;
      li.dataset.side = G.sides[i];
    });
  };

  const along = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

  const draw = () => {
    const G = geo();
    const hub = [G.gx, G.gy];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.w, G.h);
    const glow = G.nodes.map(() => 0);
    const say = G.nodes.map(() => ["", 0]);
    let flash = 0;

    ctx.lineWidth = 1;
    for (const n of G.nodes) {
      const grad = ctx.createLinearGradient(n[0], n[1], hub[0], hub[1]);
      grad.addColorStop(0, "rgba(255,255,255,0.16)");
      grad.addColorStop(1, "rgba(255,255,255,0.03)");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(n[0], n[1]);
      ctx.lineTo(hub[0], hub[1]);
      ctx.stroke();
    }

    const kMax = Math.floor(tau / PERIOD);
    const V = Math.max(380, G.w * 0.36);
    for (let k = kMax - 2; k <= kMax; k++) {
      const [who, text] = SCRIPT[((k % SCRIPT.length) + SCRIPT.length) % SCRIPT.length];
      const t = tau - k * PERIOD;
      if (t < 0 || t > PERIOD * 1.4) continue;
      const from = G.nodes[who];
      const inLen = Math.hypot(hub[0] - from[0], hub[1] - from[1]);
      const sent = 0.5;
      const atHub = sent + inLen / V;
      const typed = Math.round(text.length * smooth(0, 0.8, t));
      const fade = 1 - smooth(atHub + 1.6, atHub + 2.3, t);
      if (fade > say[who][1]) say[who] = [text.slice(0, typed), fade];
      glow[who] = Math.max(glow[who], smooth(0, 0.25, t) * (1 - smooth(sent + 0.3, atHub, t)));
      ctx.font = '400 11px "Paper Mono", ui-monospace, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ang = Math.atan2(hub[1] - from[1], hub[0] - from[0]);
      const upright = ang > Math.PI / 2 ? ang - Math.PI : ang < -Math.PI / 2 ? ang + Math.PI : ang;
      for (let j = 0; j < text.length; j++) {
        const d = (t - sent) * V - j * 9.5;
        if (d <= 6 || d >= inLen - 4) continue;
        const [x, y] = along(from, hub, d / inLen);
        const a = Math.min(1, d / 40) * Math.min(1, (inLen - d) / 50);
        ctx.fillStyle = `rgba(240,240,240,${(0.8 * a).toFixed(3)})`;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(upright);
        ctx.fillText(B64[Math.floor(hash(k * 31 + j, who) * 64)], 0, 0);
        ctx.restore();
      }
      const tail = (text.length * 9.5) / V;
      flash = Math.max(flash, smooth(atHub - 0.05, atHub + 0.1, t) * (1 - smooth(atHub + tail, atHub + tail + 0.4, t)));
      G.nodes.forEach((to, i) => {
        if (i === who) return;
        const outLen = Math.hypot(to[0] - hub[0], to[1] - hub[1]);
        const d = (t - atHub - 0.08) * V;
        if (d > 0 && d < outLen) {
          const f = d / outLen;
          const [x, y] = along(hub, to, f);
          const [tx, ty] = along(hub, to, Math.max(0, (d - 70) / outLen));
          const grad = ctx.createLinearGradient(tx, ty, x, y);
          grad.addColorStop(0, "rgba(255,255,255,0)");
          grad.addColorStop(1, "rgba(255,255,255,0.9)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        const arrive = atHub + 0.08 + outLen / V;
        glow[i] = Math.max(glow[i], smooth(arrive - 0.05, arrive + 0.05, t) * (1 - smooth(arrive + 0.2, arrive + 0.9, t)));
      });
    }

    G.nodes.forEach((n, i) => {
      const g = glow[i];
      if (g > 0.01) {
        const r = ctx.createRadialGradient(n[0], n[1], 0, n[0], n[1], 26);
        r.addColorStop(0, `rgba(255,255,255,${(0.35 * g).toFixed(3)})`);
        r.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = r;
        ctx.beginPath();
        ctx.arc(n[0], n[1], 26, 0, Math.PI * 2);
        ctx.fill();
      }
      members[i].classList.toggle("lit", g > 0.35);
      const [text, fade] = say[i];
      const cap = captions[i];
      if (cap && shown[i] !== text) {
        shown[i] = text;
        cap.textContent = text;
      }
      if (cap) cap.style.opacity = text ? fade.toFixed(3) : "0";
    });

    const q = Math.round(flash * 40) / 40;
    if (renderGlass && q !== lastFlash) {
      lastFlash = q;
      renderGlass(q, glassScale);
    }
  };

  const loop = (ms) => {
    frame = 0;
    const dt = last ? Math.min(0.05, (ms - last) / 1000) : 0;
    last = ms;
    tau += dt;
    draw();
    if (visible && !still) frame = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!frame && visible && !still) {
      last = 0;
      frame = requestAnimationFrame(loop);
    }
  };

  new ResizeObserver(() => {
    resize();
    if (!frame) draw();
  }).observe(hero);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    kick();
  }).observe(hero);
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    kick();
  });
  document.fonts.ready.then(() => {
    if (!frame) draw();
  });
  resize();
  draw();
  kick();
}

const hero = document.querySelector(".hero");
const field = document.getElementById("field");
const glass = document.getElementById("glass");
const members = [...document.querySelectorAll(".room li")];
if (hero && field instanceof HTMLCanvasElement && glass instanceof HTMLCanvasElement && members.length === 6 && !document.getElementById("landing")?.hidden) {
  start(hero, field, glass, members);
}
