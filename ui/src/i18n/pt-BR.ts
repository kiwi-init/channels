import type { Catalog } from "~/i18n/i18n"
import chatCompose from "~/i18n/pt-BR/chat-compose"
import chatFeed from "~/i18n/pt-BR/chat-feed"
import live from "~/i18n/pt-BR/live"
import settings from "~/i18n/pt-BR/settings"
import specs from "~/i18n/pt-BR/specs"

export const covers = ["chat.", "live.", "settings.", "specs.", "tasks.", "usage."]

export default {
  ...chatCompose,
  ...chatFeed,
  ...live,
  ...settings,
  ...specs,
  "settings.language": "Idioma",
  "settings.language.system": "Sistema",
  "usage.today": "Mensagens hoje",
  "usage.today.label": "Mensagens hoje: {used}",
  "usage.used.today": "{used} hoje",
  "usage.used.of": "{used} de {limit}",
  "usage.plan.free": "Grátis",
  "usage.plan.paid": "Pago",
  "usage.plan.unlimited": "Ilimitado",
  "usage.get.unlimited": "Assinar ilimitado",
  "usage.get.per.day": "Assinar {count} por dia",
  "usage.upgrade": "Fazer upgrade",
  "usage.paid.unlimited": "O plano pago é ilimitado.",
  "usage.paid.sends": { one: "O plano pago envia {count} mensagem por dia.", other: "O plano pago envia {count} mensagens por dia." },
  "usage.relay.no.limit": "Sem limite diário neste relay.",
  "usage.no.limit": "Sem limite diário.",
  "usage.fair.use": { one: "Um limite de uso justo de {count} mensagem por dia.", other: "Um limite de uso justo de {count} mensagens por dia." },
  "usage.per.day": { one: "{count} mensagem por dia.", other: "{count} mensagens por dia." },
  "usage.two.sentences": "{first} {second}",
  "usage.hint": "Nos seus canais, incluindo os agentes. Zera em {time}.",
  "usage.hint.fair.use": "O limite de uso justo do plano pago, incluindo os agentes. Zera em {time}.",
  "usage.account": "Conta",
  "usage.again.in": "As mensagens voltam a ser enviadas em {time}, às 00:00 UTC.",
  "usage.again": "As mensagens voltam a ser enviadas às 00:00 UTC.",
  "usage.ok": "OK",
  "usage.not.now": "Agora não",
  "usage.channel.out": "Este canal ficou sem mensagens hoje",
  "usage.channel.owner": "O dono deste canal",
  "usage.channel.out.sub": "{who} usou as mensagens de hoje, então ninguém pode enviar aqui por enquanto. {again}",
  "usage.used.up": "As mensagens de hoje acabaram",
  "usage.used.up.sub": "Seus canais usaram as mensagens de hoje. {again}",
  "usage.used.up.count": {
    one: "Seus canais enviaram {count} mensagem hoje, incluindo os agentes: {plan}. {again}",
    other: "Seus canais enviaram {count} mensagens hoje, incluindo os agentes: {plan}. {again}",
  },
  "usage.limit.fair.use": "o limite de uso justo do plano pago",
  "usage.limit.paid": "o limite diário do plano pago",
  "usage.limit.free": "o limite diário do plano grátis",
} satisfies Catalog
