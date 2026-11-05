import { until, type Driver } from "./eb-drive.ts";

const fillIn = ({ selector, value }: { selector: string; value: string }): boolean => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};

const clickButton = ({ name, within }: { name: string; within: string }): boolean => {
  const button = [...document.querySelectorAll<HTMLButtonElement>(`${within} button`)].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name && b.getClientRects().length > 0 && !b.disabled,
  );
  button?.click();
  return !!button;
};

export const sendMessage = ({ text, shows }: { text: string; shows: string }): boolean => {
  if ([...document.querySelectorAll<HTMLElement>(".main article.msg")].some((m) => m.textContent?.includes(shows))) return true;
  const area = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
  if (!area || !document.querySelector(".main .thread-doc")) return false;
  area.focus();
  if (area.value !== text) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    return false;
  }
  area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  return false;
};

export async function firstChannel(d: Driver, messages: number): Promise<void> {
  const step = (what: string, ms: number, act: () => Promise<boolean>) =>
    until(what, ms, () =>
      act().then(
        (done) => (done ? true : null),
        () => null,
      ),
    );
  const probe = 2_000;
  await step("the onboarding", 60_000, () => d.evaluate(clickButton, { name: "continue", within: ".onb" }, probe));
  await step("the pledge", 10_000, () => d.evaluate(fillIn, { selector: ".onb input", value: "Channels is not a harness" }, probe));
  await step("the name field", 60_000, () => d.evaluate(fillIn, { selector: 'input[aria-label="Your name"]', value: "Jonatas" }, probe));
  await step("Continue", 10_000, () => d.evaluate(clickButton, { name: "Continue", within: "body" }, probe));
  await step("New channel", 60_000, () => d.evaluate(clickButton, { name: "New channel", within: "body" }, probe));
  await step("the new channel's name", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input', value: "cold" }, probe));
  await step("Create channel", 10_000, () => d.evaluate(clickButton, { name: "Create channel", within: '[role="dialog"]' }, probe));
  for (let i = 0; i < messages; i++) {
    const text = `Message ${i + 1}: the relay deploy is done, numbers in a minute.`;
    await step(`message ${i + 1}, sent and in the conversation`, 60_000, () => d.evaluate(sendMessage, { text, shows: text }, probe));
  }
}
