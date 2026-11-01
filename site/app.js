const REPO = "kiwi-init/channels";
const RELEASE = `https://github.com/${REPO}/releases/latest/download`;
const INSTALL = `${location.origin}/install`;

const DOWNLOADS = [
  { id: "mac-arm64", os: "macOS", detail: "Apple silicon", file: "Channels-2026.10.18-mac-arm64.dmg" },
  { id: "linux-appimage", os: "Linux", detail: "AppImage", file: "Channels-2026.10.18-linux-x86_64.AppImage" },
];

const fileUrl = (d) => `${RELEASE}/${encodeURIComponent(d.file)}`;

function renderDownloads() {
  const box = document.getElementById("downloads");
  if (!box) return;
  for (const d of DOWNLOADS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = fileUrl(d);
    a.textContent = d.os;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = ` ${d.detail}`;
    li.append(a, detail);
    box.append(li);
  }
}

function guessPlatform(nav) {
  const ua = nav?.userAgent ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "";
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
  const label = document.getElementById("download-for");
  const d = DOWNLOADS.find((x) => x.id === mine);
  if (!button || !label || !d) return;
  button.href = fileUrl(d);
  label.textContent = `${d.os} · ${d.detail}`;
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
        button.textContent = "copied";
      } catch {
        // Clipboard needs a secure context and permission; select the text instead.
        const range = document.createRange();
        if (source) range.selectNodeContents(source);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        button.textContent = "copy";
      }
      setTimeout(() => (button.textContent = done), 1500);
    });
  }
}

const code = inviteCode();
if (code) showInvite(code);
else {
  renderDownloads();
  refinePlatform(navigator, guessPlatform(navigator)).then(renderPrimary);
}
wireCopy();
