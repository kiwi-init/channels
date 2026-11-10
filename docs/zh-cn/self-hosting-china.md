---
description: 在一台普通的 Linux 服务器上运行你自己的中继，适合访问 Cloudflare 上的公共中继较慢或无法访问的团队。用 Docker 或 systemd，用 Caddy 提供 TLS，以及目前还没有人测试过的部分。
group: 信任
order: 32
---

# 在 Cloudflare 较慢的地方自托管

> 本页的中文尚未经过母语者审阅。如果有不准确或读起来别扭的地方，欢迎在 [GitHub](https://github.com/kiwi-init/channels) 上提 issue 或 PR 指正。

公共中继运行在 Cloudflare 上。如果从你的网络访问它很慢或无法访问，可以在离团队较近的一台 Linux 服务器上自己运行中继。应用、CLI 和智能体连接它时的用法完全一样，消息始终是端到端加密的。

本页只讲一种情况的最短路径：在一台 Linux 虚拟机上运行 Bun 中继，这种机器阿里云、腾讯云或任何 VPS 服务商都有售。[自托管](self-hosting.md)是完整的参考，本页的每条命令都出自那里。

## 尚未测试的部分

请先读这一节。

- **项目里还没有人在阿里云或腾讯云上、或从中国大陆运行过这套步骤。** 这些命令就是我们的测试在 Linux 上运行的命令。它们在这些网络中的表现，我们并不清楚。
- **我们没有镜像。** 应用、CLI 及其更新都从 GitHub 下载。见[获取应用和 CLI](#getting-the-app-and-the-cli)。
- 如果你试过，请在 [GitHub issue](https://github.com/kiwi-init/channels/issues) 中告诉我们结果。一份来自真实网络的反馈，比本页的任何内容都更有价值。

## 选择服务器所在的地区

域名指向中国大陆的服务器时，必须先完成 ICP 备案才能对外提供服务。位于中国香港或大陆以外的服务器则不需要。这是服务商自己的说法：

- 阿里云：“Websites, apps, and other services with domain names resolving to servers in the Chinese mainland must obtain an ICP filing before providing services.”（[What is ICP filing](https://www.alibabacloud.com/help/en/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing)，英文）
- 腾讯云对大陆境内的云资源有同样的要求，并写明：“中国香港地区及境外地区的云服务器无需进行备案，也不能用于备案。”（[ICP 备案：备案云资源](https://cloud.tencent.com/document/product/243/18908)）

其他服务商请查看它们自己的页面。我们只对中继负责，不是这些规定的依据。

中继的要求很低：一个进程，每个频道一个 SQLite 文件。任何一台有公网地址、开放了 80 和 443 端口、并有域名指向它的小型 Linux 机器都可以。

## 安装中继

你需要 [Bun](https://bun.sh) 1.4 或更高版本，以及 git。下面的命令在 systemd 下以独立用户运行中继，绑定到回环地址：

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

该 unit 期望 Bun 位于 `/usr/local/bin/bun`。用 `Environment=` 行添加设置，机密则放进只有 root 可读的 `EnvironmentFile=`。

克隆仓库和 `bun install` 需要访问 GitHub 和 npm 源。如果服务器访问它们很慢，问题会首先出现在这一步。

### 改用 Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

只把端口发布在回环地址上。在容器内部，对端是网桥网关，通常是 `172.17.0.1`（`docker network inspect bridge` 会显示它），所以要在 `KIWI_TRUST_PROXY` 中写明它。

## 用 Caddy 提供 TLS

客户端需要 HTTPS 和 WebSocket。让中继运行在回环地址上，并在前面放上 Caddy。[`deploy/Caddyfile`](../deploy/Caddyfile)，填上你的域名：

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

一旦域名指向这台机器，并且 80 和 443 端口已开放，Caddy 就会获取并续期证书，并透传 WebSocket。请给中继传入 `--trust-proxy`（上面的 systemd unit 和 Docker 命令已经这样做了），这样每个客户端会被视为 Caddy 看到的地址。

## 登录是可选的

不配置任何登录设置时，中继没有账户：任何能访问它的人都可以创建频道。加入频道仍然需要频道所有者放行，不在频道里的人读不到其中的内容。对团队自用的中继来说，这通常已经足够；不要把地址公开即可。

需要登录时，登录通过你自己注册的 GitHub App 完成，因此要求大家的电脑能访问 GitHub。步骤见[登录](self-hosting.md#sign-in)。查看你的中继提供了什么：

```bash
curl -s https://relay.example.com/v1/config
```

频道中的 GitHub 事件和手机推送同样是可选的，各自依赖一项外部服务。[自托管](self-hosting.md)列出了它们。

## 让应用和 kiwi 指向它

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

在应用中，到设置里填写中继 URL。每个频道都会记住自己的中继，所以一台电脑可以同时加入多个中继上的频道。

## 获取应用和 CLI

- **应用**从本项目的 [GitHub releases](https://github.com/kiwi-init/channels/releases/latest) 下载，并通过 GitHub 检查更新。
- **CLI。** 安装命令会从 `channels.kiwiinit.com`（位于 Cloudflare 上）获取一个脚本，脚本再从 GitHub releases 下载 `kiwi` 可执行文件，并用该版本的 `SHA256SUMS` 校验：

```bash
curl -fsSL https://channels.kiwiinit.com/install | sh
```

- **从源码构建**：当一台机器访问不到上面两处、但有仓库的检出时，`bun run build` 会生成 `dist/kiwi`，这是一个可以拷贝到其他电脑的单文件。

发布文件没有镜像。如果你的网络访问不了 GitHub，请在能访问的机器上下载，再把文件拷贝过去。无论拷贝什么，都请先用该版本的 `SHA256SUMS` 核对。
