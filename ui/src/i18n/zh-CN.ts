import type { Catalog } from "~/i18n/i18n"
import chatCompose from "~/i18n/zh-CN/chat-compose"
import chatFeed from "~/i18n/zh-CN/chat-feed"
import live from "~/i18n/zh-CN/live"
import settings from "~/i18n/zh-CN/settings"
import specs from "~/i18n/zh-CN/specs"
import modals from "~/i18n/zh-CN/modals"
import needs from "~/i18n/zh-CN/needs"
import shell from "~/i18n/zh-CN/shell"
import github from "~/i18n/zh-CN/github"

export const covers = ["chat.", "github.", "kit.", "live.", "modals.", "needs.", "palette.", "panels.", "settings.", "shell.", "specs.", "start.", "tasks.", "usage."]

export default {
  ...chatCompose,
  ...chatFeed,
  ...live,
  ...settings,
  ...specs,
  ...modals,
  ...needs,
  ...shell,
  ...github,
  "settings.language": "语言",
  "settings.language.system": "跟随系统",
  "usage.today": "今日消息",
  "usage.today.label": "今日消息：{used}",
  "usage.used.today": "今日 {used} 条",
  "usage.used.of": "{used} / {limit}",
  "usage.plan.free": "免费",
  "usage.plan.paid": "付费",
  "usage.plan.unlimited": "无限",
  "usage.get.unlimited": "升级到无限",
  "usage.get.per.day": "升级到每天 {count} 条",
  "usage.upgrade": "升级",
  "usage.paid.unlimited": "付费方案不限消息数量。",
  "usage.paid.sends": { other: "付费方案每天可发送 {count} 条消息。" },
  "usage.relay.no.limit": "此中继没有每日上限。",
  "usage.no.limit": "没有每日上限。",
  "usage.fair.use": { other: "合理使用上限为每天 {count} 条消息。" },
  "usage.per.day": { other: "每天 {count} 条消息。" },
  "usage.two.sentences": "{first}{second}",
  "usage.hint": "按你拥有的频道计算，包括智能体。{time}后重置。",
  "usage.hint.fair.use": "付费方案的合理使用上限，包括智能体。{time}后重置。",
  "usage.account": "账户",
  "usage.again.in": "{time}后（UTC 00:00）可以再次发送。",
  "usage.again": "UTC 00:00 后可以再次发送。",
  "usage.ok": "好",
  "usage.not.now": "以后再说",
  "usage.channel.out": "此频道今天的消息已用完",
  "usage.channel.owner": "此频道的所有者",
  "usage.channel.out.sub": "{who}已用完今天的消息，暂时没人能在这里发送。{again}",
  "usage.used.up": "今天的消息已用完",
  "usage.used.up.sub": "你的频道已用完今天的消息。{again}",
  "usage.used.up.count": { other: "你的频道今天发送了 {count} 条消息（包括智能体），已达到{plan}。{again}" },
  "usage.limit.fair.use": "付费方案的合理使用上限",
  "usage.limit.paid": "付费方案的每日上限",
  "usage.limit.free": "免费方案的每日上限",
} satisfies Catalog
