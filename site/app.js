const REPO = "kiwi-init/channels";
const RELEASE = `https://github.com/${REPO}/releases/latest/download`;
const INSTALL = `${location.origin}/install`;
const IOS_BETA = "https://testflight.apple.com/join/qvKqgRNJ";

const DOWNLOADS = [
  { id: "mac-arm64", os: "macOS", detail: "Apple silicon", file: "Channels-2026.11.20-mac-arm64.dmg" },
  { id: "linux-appimage", os: "Linux", detail: "AppImage", file: "Channels-2026.11.20-linux-x86_64.AppImage" },
];

const WORDS = {
  "pt-BR": { ios: "Baixar beta para iOS", copied: "copiado" },
  ja: { ios: "iOS ベータ版を入手", copied: "コピーしました" },
  ko: { ios: "iOS 베타 받기", copied: "복사됨" },
  "zh-CN": { ios: "获取 iOS 测试版", copied: "已复制" },
};
const words = WORDS[document.documentElement?.lang] ?? { ios: "Get iOS Beta", copied: "copied" };

const fileUrl = (d) => `${RELEASE}/${encodeURIComponent(d.file)}`;

function guessPlatform(nav) {
  const ua = nav?.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac-arm64";
  if (/aarch64|arm/i.test(ua)) return "";
  if (/Linux|X11/i.test(ua)) return "linux-appimage";
  return "";
}

async function refinePlatform(nav, guess) {
  const hints = nav?.userAgentData;
  if (guess !== "mac-arm64" || typeof hints?.getHighEntropyValues !== "function") return guess;
  try {
    const { architecture } = await hints.getHighEntropyValues(["architecture"]);
    return architecture === "x86" ? "" : guess;
  } catch {
    // Client hints can be refused; Apple silicon is the likelier Mac, and the list below has the rest.
    return guess;
  }
}

function renderPrimary(mine) {
  const button = document.getElementById("download");
  if (button && mine === "ios") {
    button.href = IOS_BETA;
    button.textContent = words.ios;
    button.title = "TestFlight";
    document.getElementById("ios-beta")?.remove();
    return;
  }
  const d = DOWNLOADS.find((x) => x.id === mine);
  if (!button || !d) return;
  button.href = fileUrl(d);
  button.title = `${d.os} · ${d.detail}`;
}

const LOOKS = [
  [-0.32, [0x070d24, 0x18244a, 0x223056, 0x1d2433], [0x070d24, 0x18244a, 0x223056, 0x1d2433]],
  [-0.08, [0x2c3b78, 0xc58aa2, 0xd8a6ac, 0x4f5a4a], [0x272a66, 0xd07c8c, 0xc78c99, 0x4f5a4a]],
  [0.12, [0x6a8cc4, 0xf5c7a3, 0xf5dac4, 0x66784c], [0x5a74b6, 0xf6ad7b, 0xf2c69e, 0x66784c]],
  [0.45, [0x6e9ccb, 0xb7cde2, 0xe8e4dc, 0x6f8256], [0x6e9ccb, 0xb7cde2, 0xe8e4dc, 0x6f8256]],
];

const mixHex = (a, b, t) => `rgb(${[16, 8, 0].map((s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t)).join(" ")})`;

function paintSky(box, at) {
  const hour = at.getHours() + at.getMinutes() / 60;
  const sunY = Math.sin((Math.PI * (hour - 6)) / 12);
  const side = hour < 12 ? 1 : 2;
  let i = LOOKS.findIndex(([y]) => sunY <= y);
  if (i < 0) i = LOOKS.length - 1;
  const lo = LOOKS[Math.max(0, i - 1)];
  const hi = LOOKS[i];
  const span = hi[0] - lo[0];
  const raw = span > 0 ? Math.min(1, Math.max(0, (sunY - lo[0]) / span)) : 1;
  const t = raw * raw * (3 - 2 * raw);
  document.body.dataset.sky = sunY < -0.08 ? "night" : "day";
  ["--sky-top", "--sky-low", "--sky-haze", "--ground"].forEach((name, k) => box.style.setProperty(name, mixHex(lo[side][k], hi[side][k], t)));
}

function startScene() {
  const box = document.getElementById("scene");
  if (!box) return;
  paintSky(box, new Date());
  const frame = document.createElement("iframe");
  frame.src = "/afk/scene";
  frame.title = "";
  frame.tabIndex = -1;
  frame.setAttribute("sandbox", "allow-scripts");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const send = () => frame.contentWindow?.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs: 0, still: still.matches }, "*");
  let ready = false;
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.data?.kiwi !== "afk" || e.data.type !== "ready") return;
    ready = true;
    frame.classList.add("is-ready");
  });
  frame.addEventListener("load", () => {
    send();
    setTimeout(() => ready || frame.remove(), 5000);
  });
  still.addEventListener("change", send);
  box.append(frame);
}

function showInvite(code) {
  const landing = document.getElementById("landing");
  const invite = document.getElementById("invite");
  if (!code || !landing || !invite) return;
  landing.hidden = true;
  invite.hidden = false;
  const open = document.getElementById("open-app");
  if (open) open.href = `kiwi://join/${code}`;
  const cmd = document.getElementById("join-cmd");
  if (cmd) cmd.textContent = `curl -fsSL ${INSTALL} | sh -s -- join ${code}`;
}

function inviteCode() {
  const fromPath = /^\/join\/(mc2-[A-Za-z0-9_-]+)\/?$/.exec(location.pathname);
  if (fromPath) return fromPath[1];
  const hash = location.hash.replace(/^#/, "").trim();
  return /^mc2-[A-Za-z0-9_-]+$/.test(hash) ? hash : "";
}

function wireCopy() {
  for (const button of document.querySelectorAll("button[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.getAttribute("data-copy"));
      const text = source ? source.textContent.trim() : "";
      if (!text) return;
      const done = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = words.copied;
      } catch {
        // Clipboard needs a secure context and permission; select the text instead.
        const range = document.createRange();
        if (source) range.selectNodeContents(source);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        button.textContent = done;
      }
      setTimeout(() => (button.textContent = done), 1500);
    });
  }
}

const code = inviteCode();
if (code) showInvite(code);
else {
  startScene();
  refinePlatform(navigator, guessPlatform(navigator)).then(renderPrimary);
}
wireCopy();
