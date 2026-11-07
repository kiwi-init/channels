import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { until, type Driver } from "./eb-drive.ts";

export const fillIn = ({ selector, value }: { selector: string; value: string }): boolean => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};

const gone = ({ selector }: { selector: string }): boolean => !document.querySelector(selector);

const clickButton = ({ name, within, step }: { name: string; within: string; step: string }): boolean => {
  const w = window as unknown as { kiwiClicks?: { step: string; said: string }[] };
  if (w.kiwiClicks?.some((c) => c.step === step)) return true;
  const button = [...document.querySelectorAll<HTMLButtonElement>(`${within} button`)].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name && b.getClientRects().length > 0 && !b.disabled,
  );
  if (!button) return false;
  const screen = document.querySelector("dialog.onb .onb-wire") ? "trust" : document.querySelector("dialog.onb .onb-input") ? "pledge" : document.querySelector("dialog.onb") ? "intro" : "app";
  (w.kiwiClicks ??= []).push({ step, said: `${Math.round(performance.now())} ms: ${name} in ${within}, on the ${screen} screen` });
  button.click();
  return true;
};

const seen = (): string => {
  const w = window as unknown as { kiwiClicks?: { step: string; said: string }[] };
  const onb = document.querySelector("dialog.onb");
  const screen = onb?.querySelector(".onb-wire") ? "trust" : onb?.querySelector(".onb-input") ? "pledge" : onb ? "intro" : "app";
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(onb ? "dialog.onb button" : "button")]
    .slice(0, 12)
    .map(
      (b) =>
        `${JSON.stringify((b.getAttribute("aria-label") ?? b.textContent ?? "").trim())}${b.getClientRects().length ? "" : " hidden"}${b.disabled ? " disabled" : ""} opacity ${getComputedStyle(b).opacity}`,
    );
  const focus = document.activeElement;
  return [
    `at ${Math.round(performance.now())} ms, on the ${screen} screen${onb ? `, the dialog ${(onb as HTMLDialogElement).open ? "open" : "closed"}` : ""}`,
    `clicks: ${(w.kiwiClicks ?? []).map((c) => c.said).join("; ") || "none"}`,
    `buttons: ${buttons.join(", ") || "none"}`,
    `focus: ${focus ? `${focus.tagName.toLowerCase()}.${focus.className}` : "none"}`,
    `onboarding: ${onb ? onb.outerHTML.replace(/\s+/g, " ").slice(0, 800) : "none"}`,
  ].join("\n  ");
};

interface Evidence {
  shots?: string | null;
  home?: string;
}

function logsUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? logsUnder(p) : n === "main.log" ? [p] : [];
  });
}

async function stalled(d: Driver, what: string, evidence: Evidence): Promise<void> {
  const page = await d.evaluate(seen, null, 10_000).catch((e: Error) => `the page didn't answer: ${e.message}`);
  console.log(`${what} stalled:\n  ${page}`);
  if (evidence.shots) {
    mkdirSync(evidence.shots, { recursive: true });
    const file = join(evidence.shots, "first-run-stall.png");
    const r = process.platform === "darwin" ? spawnSync("screencapture", ["-x", file], { stdio: "ignore" }) : spawnSync("import", ["-window", "root", file], { stdio: "ignore" });
    console.log(r.status === 0 && existsSync(file) ? `shot ${file}` : "no shot of the stall here");
  }
  for (const f of evidence.home ? logsUnder(evidence.home) : []) console.log(`${f}, its last 40 lines:\n${readFileSync(f, "utf8").trimEnd().split("\n").slice(-40).join("\n")}`);
}

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

export async function firstChannel(d: Driver, messages: number, evidence: Evidence = {}): Promise<void> {
  const step = async (what: string, ms: number, act: () => Promise<boolean>) => {
    const start = Date.now();
    const missed: string[] = [];
    await until(what, ms, () =>
      act().then(
        (done) => (done ? true : null),
        (e: Error) => (missed.push(`${Date.now() - start} ms: ${e.message}`), null),
      ),
    ).catch(async (e: Error) => {
      if (missed.length) console.log(`${what}: ${missed.length} probes failed (${missed.slice(0, 5).join("; ")})`);
      await stalled(d, what, evidence);
      throw e;
    });
    if (missed.length) console.log(`${what}: done after ${Date.now() - start} ms, and ${missed.length} probes failed first (${missed.slice(0, 5).join("; ")})`);
  };
  const probe = 2_000;
  const click = (what: string, ms: number, name: string, within: string) => step(what, ms, () => d.evaluate(clickButton, { name, within, step: what }, probe));
  await click("the onboarding", 60_000, "continue", ".onb");
  await click("the onboarding's second screen", 10_000, "continue", ".onb:has(.onb-wire)");
  await step("the pledge", 10_000, () => d.evaluate(fillIn, { selector: ".onb input", value: "Channels is not a harness" }, probe));
  await step("the onboarding closes", 10_000, () => d.evaluate(gone, { selector: "dialog.onb" }, probe));
  await step("the name field", 60_000, () => d.evaluate(fillIn, { selector: 'input[aria-label="Your name"]', value: "Jonatas" }, probe));
  await click("Continue", 10_000, "Continue", "body");
  await click("New channel", 60_000, "New channel", "body");
  await step("the new channel's name", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input', value: "cold" }, probe));
  await click("Create channel", 10_000, "Create channel", '[role="dialog"]');
  for (let i = 0; i < messages; i++) {
    const text = `Message ${i + 1}: the relay deploy is done, numbers in a minute.`;
    await step(`message ${i + 1}, sent and in the conversation`, 60_000, () => d.evaluate(sendMessage, { text, shows: text }, probe));
  }
}
