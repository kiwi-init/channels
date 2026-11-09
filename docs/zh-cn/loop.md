---
description: kiwi loop 为每个任务启动一个全新的智能体会话，让每个任务都从很小的上下文开始。
group: 智能体
order: 13
---

# 每个任务一个会话

席位不必一直待在一个长会话里。`kiwi loop` 在席位所在文件夹的 tmux 窗口中运行，为每一项工作启动一个全新的智能体工具会话。工作完成后会话就结束，所以每个任务都从很小的上下文开始，而不必背着这个席位之前做过的一切。

<!-- figure: loop -->

```bash
kiwi loop                                         # Claude Code, with its default model
kiwi loop --harness codex --model gpt-6-astra --effort high
kiwi loop --harness kimi                          # inside tmux: Kimi's first prompt is typed in
```

它可以运行 `claude`、`codex`、`grok`、`mimo`、`kimi` 或 `zcode`。

## 它挑选什么

按以下顺序：

1. 席位正在做的任务。
2. 它欠下的审核轮次。
3. 它其他待办的任务。
4. 它自己正在等待裁定的任务。
5. 发给它的消息。

席位空闲时，它还会接手一个正在等待智能体的已批准规格，并持有租约，所以两个 loop 永远不会规划同一个规格。

## 一次会话如何运行

1. **它占住席位**。其他任何东西都不会读取席位的消息或移动它的游标，所以新到的内容会等这次会话来处理。
2. **它启动智能体工具**，使用干净的环境，并带上第一条提示：说明要做的工作、如何收尾（`kiwi task review T7 --at SHA`、`kiwi task done T7`、一个裁定），并附上任务的检查点。
3. **它把席位绑定**到这次会话，让会话的钩子和命令以这个席位的身份行事。
4. **工作结束时它会结束会话**：任务已完成或已交接、审核轮次已关闭、没有未读内容。它会等待会话空闲，最多 15 分钟，然后停止会话。

编码会话在等待裁定期间，只有会改变它工作的内容才会唤醒它：发给它的消息、它任务的讨论串、裁定、暂停。其他一切都等到下一次会话。

长任务可以要求重新开始：`kiwi task checkpoint T7 --fresh --file note.md` 会保存当前进展，并在本轮结束后结束会话。下一次会话会从那个检查点继续同一个任务。

## 停止它

没有会话运行时按 Ctrl-C，或随时发送 SIGTERM 或 SIGHUP。loop 随后会释放席位。没有释放席位就退出的 loop，会被下一个 loop 接管，或者用 `kiwi seat release --stale` 释放。

loop 从不替你回答智能体工具的对话框（“Trust this folder?”、权限提示）：它会等你。

负责人始终是一个长会话，靠它的智能体工具自带的压缩功能保持状态。
