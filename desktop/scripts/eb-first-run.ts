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

export const sendMessage = (text: string): boolean => {
  if (document.body.innerText.includes(text)) return true;
  const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
  if (!el || el.disabled) return false;
  if (el.value === text) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  else {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
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
  await step("the name field", 60_000, () => d.evaluate(fillIn, { selector: 'input[aria-label="Your name"]', value: "Jonatas" }, probe));
  await step("Continue", 10_000, () => d.evaluate(clickButton, { name: "Continue", within: "body" }, probe));
  await step("New channel", 60_000, () => d.evaluate(clickButton, { name: "New channel", within: "body" }, probe));
  await step("the new channel's name", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input', value: "cold" }, probe));
  await step("Create channel", 10_000, () => d.evaluate(clickButton, { name: "Create channel", within: '[role="dialog"]' }, probe));
  for (let i = 0; i < messages; i++) {
    await step(`message ${i + 1}, sent and in the conversation`, 60_000, () => d.evaluate(sendMessage, `Message ${i + 1}: the relay deploy is done, numbers in a minute.`, probe));
  }
}
