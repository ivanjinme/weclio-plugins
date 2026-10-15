import type { Api } from "@earendil-works/pi-ai";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register, { WEB_SEARCH_SECTION } from "../index.js";

function promptHook(api: Api = "openai-responses") {
  let handler: ((event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown) | undefined;
  register({
    on(name: string, callback: typeof handler) {
      if (name === "before_agent_start") handler = callback;
    },
  } as unknown as ExtensionAPI);
  const options: NormalizedBuildSystemPromptOptions = {
    cwd: process.cwd(), selectedTools: [], toolSnippets: {}, toolGuidelines: {},
    promptGuidelines: [], appendSystemPrompt: "", contextFiles: [], skills: [],
    sections: { other_extension: "Other rules" },
  };
  const event: BeforeAgentStartEvent = {
    type: "before_agent_start", prompt: "Test", systemPromptOptions: options,
    get systemPrompt(): string { throw new Error("Must not read or replace the complete prompt"); },
  };
  const ctx = { model: { api } } as unknown as ExtensionContext;
  return { options, invoke: () => handler!(event, ctx) };
}

beforeEach(() => vi.stubEnv("PI_WEB_SEARCH", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("incremental search prompt", () => {
  it.each(["openai-responses", "azure-openai-responses", "openai-codex-responses"] as const)("adds one independent section for %s", (api) => {
    const hook = promptHook(api);
    expect(hook.invoke()).toBeUndefined();
    expect(hook.options.sections).toEqual({ other_extension: "Other rules", web_search: WEB_SEARCH_SECTION.trim() });
    expect(hook.options.forceSystemPrompt).toBeUndefined();
    hook.invoke();
    expect(hook.options.sections.web_search).toBe(WEB_SEARCH_SECTION.trim());
  });

  it("does not inject search instructions when disabled", () => {
    vi.stubEnv("PI_WEB_SEARCH", "0");
    const hook = promptHook();
    hook.invoke();
    expect(hook.options.sections).toEqual({ other_extension: "Other rules" });
  });

  it("does not inject search instructions for an unsupported API", () => {
    const hook = promptHook("anthropic-messages");
    hook.invoke();
    expect(hook.options.sections).toEqual({ other_extension: "Other rules" });
  });
});
