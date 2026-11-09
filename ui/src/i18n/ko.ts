import type { Catalog } from "~/i18n/i18n"
import chatCompose from "~/i18n/ko/chat-compose"
import chatFeed from "~/i18n/ko/chat-feed"
import specs from "~/i18n/ko/specs"
import modals from "~/i18n/ko/modals"
import needs from "~/i18n/ko/needs"
import shell from "~/i18n/ko/shell"
import github from "~/i18n/ko/github"

export const covers = ["chat.", "github.", "kit.", "modals.", "needs.", "palette.", "panels.", "settings.language.", "shell.", "specs.", "start.", "tasks.", "usage."]

export default {
  ...chatCompose,
  ...chatFeed,
  ...specs,
  ...modals,
  ...needs,
  ...shell,
  ...github,
  "settings.language": "언어",
  "settings.language.system": "시스템",
  "usage.today": "오늘 메시지",
  "usage.today.label": "오늘 메시지: {used}",
  "usage.used.today": "오늘 {used}개",
  "usage.used.of": "{used} / {limit}",
  "usage.plan.free": "무료",
  "usage.plan.paid": "유료",
  "usage.plan.unlimited": "무제한",
  "usage.get.unlimited": "무제한 이용하기",
  "usage.get.per.day": "하루 {count}개 이용하기",
  "usage.upgrade": "업그레이드",
  "usage.paid.unlimited": "유료 플랜은 무제한입니다.",
  "usage.paid.sends": { other: "유료 플랜은 하루 {count}개의 메시지를 보낼 수 있습니다." },
  "usage.relay.no.limit": "이 릴레이에는 하루 한도가 없습니다.",
  "usage.no.limit": "하루 한도가 없습니다.",
  "usage.fair.use": { other: "공정 사용 한도는 하루 {count}개입니다." },
  "usage.per.day": { other: "하루 {count}개." },
  "usage.two.sentences": "{first} {second}",
  "usage.hint": "내 채널 기준이며 에이전트도 포함됩니다. {time} 후 초기화됩니다.",
  "usage.hint.fair.use": "유료 플랜의 공정 사용 한도이며 에이전트도 포함됩니다. {time} 후 초기화됩니다.",
  "usage.account": "계정",
  "usage.again.in": "{time} 후(UTC 00:00)에 다시 보낼 수 있습니다.",
  "usage.again": "UTC 00:00에 다시 보낼 수 있습니다.",
  "usage.ok": "확인",
  "usage.not.now": "나중에",
  "usage.channel.out": "이 채널은 오늘 메시지를 모두 사용했습니다",
  "usage.channel.owner": "이 채널의 소유자",
  "usage.channel.out.sub": "{who}님이 오늘 메시지를 모두 사용해서 지금은 아무도 여기서 보낼 수 없습니다. {again}",
  "usage.used.up": "오늘 메시지를 모두 사용했습니다",
  "usage.used.up.sub": "내 채널이 오늘 메시지를 모두 사용했습니다. {again}",
  "usage.used.up.count": { other: "내 채널에서 오늘 에이전트를 포함해 {count}개의 메시지를 보냈습니다: {plan}. {again}" },
  "usage.limit.fair.use": "유료 플랜의 공정 사용 한도",
  "usage.limit.paid": "유료 플랜의 하루 한도",
  "usage.limit.free": "무료 플랜의 하루 한도",
} satisfies Catalog
