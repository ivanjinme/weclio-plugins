import type {
  ContextEventResult, ContextWithSystemEvent, ExtensionAPI, ExtensionContext, ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import persona from "../index.js";

type Messages = ContextWithSystemEvent["messages"];
async function transform(messages: Messages) {
  const on = vi.fn();
  persona({ on } as unknown as ExtensionAPI);
  expect(on).toHaveBeenCalledTimes(1);
  expect(on.mock.calls[0]![0]).toBe("context_with_system");
  const handler = on.mock.calls[0]![1] as ExtensionHandler<ContextWithSystemEvent, ContextEventResult>;
  const result = await handler({ type: "context_with_system", messages }, {} as ExtensionContext);
  return result?.messages ?? messages;
}

function system(preamble: string) {
  return { role: "system" as const, content: "", timestamp: 0, sections: { preamble } };
}

describe("Weclio persona", () => {
  it("changes only the opening identity, preserving sections, tool state and original messages", async () => {
    const original = {
      ...system("You are an expert coding assistant."), toolsRemoved: [{ name: "old_tool" }],
      sections: { preamble: "You are an expert coding assistant.", tools: "tools", rules: "rules", docs: "docs", skills: "skills", cwd: "cwd", future_section: "future" },
    };
    const snapshot = structuredClone(original);
    const user = { role: "user" as const, content: "hello", timestamp: 1 };
    const [updated, sameUser] = await transform([original, user]);
    expect(updated?.role).toBe("system");
    if (updated?.role !== "system") throw Error("Missing system message");
    expect(updated.sections?.preamble).toMatch(/^You are an AI toxicologist created by WeClio\./);
    expect(updated.sections?.preamble).toContain("medical-device extractables and leachables (E&L)");
    expect({ ...updated, sections: { ...updated.sections, preamble: original.sections.preamble } }).toEqual(original);
    expect(sameUser).toBe(user);
    expect(original).toEqual(snapshot);
  });

  it.each(["\n\n", "\r\n\r\n"])("preserves custom instructions after the first paragraph (%j)", async (separator) => {
    const [updated] = await transform([system(`Old identity${separator}Keep these instructions.${separator}And these.`)]);
    if (updated?.role !== "system") throw Error("Missing system message");
    expect(updated.sections?.preamble).toMatch(/^You are an AI toxicologist/);
    expect(updated.sections?.preamble?.endsWith(`${separator}Keep these instructions.${separator}And these.`)).toBe(true);
  });

  it.each(["\n\n", "\r\n\r\n", " \n \n", "\n\n\n\n"])("replaces the first non-empty paragraph after leading whitespace (%j)", async (leading) => {
    const [updated] = await transform([system(`${leading}You are an expert coding assistant.\n\nKeep these instructions.`)]);
    if (updated?.role !== "system") throw Error("Missing system message");
    expect(updated.sections?.preamble?.startsWith(`${leading}You are an AI toxicologist`)).toBe(true);
    expect(updated.sections?.preamble).not.toContain("You are an expert coding assistant.");
    expect(updated.sections?.preamble?.endsWith("\n\nKeep these instructions.")).toBe(true);
  });

  it("also transforms later identity patches and is idempotent", async () => {
    const messages = [system("Original identity"), { ...system("Updated identity"), timestamp: 2 }];
    const updated = await transform(messages);
    for (const message of updated) {
      if (message.role !== "system") throw Error("Unexpected message");
      expect(message.sections?.preamble).toMatch(/^You are an AI toxicologist/);
    }
    expect(await transform(updated)).toEqual(updated);
  });

  it("leaves tool-only patches, section removals and opaque prompts untouched", async () => {
    const messages: Messages = [
      { role: "system", content: "", timestamp: 0, sections: { tools: "new tools" } },
      { role: "system", content: "", timestamp: 1, sections: { preamble: null } },
      { role: "system", content: "Explicit full prompt", timestamp: 2 },
    ];
    const updated = await transform(messages);
    updated.forEach((message, index) => expect(message).toBe(messages[index]));
  });
});
