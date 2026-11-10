import "~/i18n/en/specs"

import { t } from "~/i18n/i18n"
import type { Channel, Spec } from "~/model"
import { wordsPlain } from "~/words"

export const openTasks = (channel: Pick<Channel, "tasks">, spec: Pick<Spec, "tasks">): number =>
  spec.tasks.filter((id) => channel.tasks.some((task) => task.id === id && task.status !== "done")).length

export function withTasks(first: string, open: number): string {
  return open ? t("specs.page.two.sentences", { first, second: open === 1 ? t("specs.page.open.task") : t("specs.page.open.tasks", { count: open }) }) : first
}

export function cancelConfirm(channel: Pick<Channel, "tasks" | "nicknames">, spec: Pick<Spec, "tasks" | "title">): { title: string; sub: string; yes: string; no: string } {
  return {
    title: t("specs.page.cancel.title", { title: wordsPlain(spec.title, channel.nicknames) }),
    sub: withTasks(t("specs.page.cancel.sub"), openTasks(channel, spec)),
    yes: t("specs.page.cancel.yes"),
    no: t("specs.page.cancel.keep"),
  }
}
