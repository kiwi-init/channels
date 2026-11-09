---
description: 人的提问如何变成规格，规格如何变成任务，以及由谁来判定它已完成。
group: 智能体
order: 11
---

# 规格和任务

人提出需求。智能体和他们一起把它写成**规格**。人批准后，第一个空闲的智能体就会开始做。规格之内，由智能体决定；规格之外，它们要先问人。

<!-- figure: spec -->

## 规格

人的一条消息对应的规格是一份 markdown：为什么要做、包含什么、不包含什么、仍待解答的问题，以及证明它已完成的条目。

```markdown
# Export the board as CSV

## Done when
- [ ] The Tasks view has an Export button that saves `board.csv`
- [ ] Maya opens it in Numbers and the columns line up
```

- 负责人或任何智能体起草它：`kiwi spec write 150 --file spec.md`。
- 任何人都可以编辑它，也可以评论其中的某一行：在应用中选中文字，或用 `kiwi spec comment 150 "…" --on "the line"`。评论就是那条消息讨论串中的回复，所以智能体会像读其他讨论串一样读它们。

## 批准

人批准的是自己读过的那个版本：提出需求的人、所有者，或所有者允许做决定的人。绝不会是智能体。批准会注明那个版本，所以有人阅读期间所做的修改无法蒙混过关。

批准之后，勾选条目就代表进展：`kiwi spec tick 150 "columns line up"`。其他任何编辑都算作变更，以差异形式展示给人，新的工作要等人批准后才开始。已经开始的工作会继续进行。

## 它会自己开始

规格一经批准，第一个手头没事的智能体就会接手。[`kiwi loop`](loop.md) 会在它的席位空闲时接手；处于长会话中的智能体会被这次批准唤醒，并运行 `kiwi spec start 150`。它把规格拆分成任务，归在这条消息下（`kiwi task add "…" --ask 150`），空闲的智能体再去接那些待办的任务。

开启**任务只来自已批准的规格**时（所有者的开关，在应用中创建的每个频道都默认开启），每个任务都是某个已批准规格中的一个步骤。GitHub issue 也以同样的方式变成工作：`kiwi task add --ask 150 --issue 12`。

## 阶段

没人手动设置阶段。阶段随实际发生的事而变化。

| 阶段 | 何时 |
| --- | --- |
| 草稿 | 直到有人批准它 |
| 已批准 | 等待智能体，并显示排队位置 |
| 进行中 | 它有未完成的任务 |
| 已交付 | 所有任务已完成，所有条目已勾选 |
| 已接受或已放弃 | 人的裁定 |

人也可以附上备注把它**退回**：它会重新等待智能体，备注就是规划者收到的第一条指示。放弃它会把它未完成的任务搁置。

## 任务

任务先是待办，然后进行中，最后已完成。

```bash
kiwi task add "freeze protocol v1" --ask 150 --start   # file it and take it
kiwi task assign T3 win "edge detection works; multi-monitor next"
kiwi task checkpoint T3 --file note.md                 # where it stands, for the next session
kiwi task done T3
```

`kiwi task start` 只在没人接手时才会接下任务：两个智能体抢同一个任务时，一个会抢到，另一个会被告知是谁拿到了它。

## 在应用中

**规格**视图是工作所在的地方：顶部是“现在”卡片，下面是按需要分组的规格（等你处理、进行中、等待智能体、草稿），每个规格下列出它未完成的任务。打开一个规格，分为三个部分：

- **规格**：正文，评论显示在页边，紧挨着它们引用的那一行。
- **内部**：一眼看清智能体的工作，每个任务附带它的 PR，每条消息都只需一次点击。
- **结果**：完成条件、已合并的 PR、尝试过的方法，以及接受、退回或放弃。
