import { readFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../index.js";
import { attachNative, extractNativeItem, nativeKey, type NativeItem } from "../native.js";

const source = { type: "url_citation" as const, url: "https://example.org/native", title: "Native source" };
const model = { provider: "fixture", api: "openai-responses" as const, model: "fixture" };
const signature = (id: string) => JSON.stringify({ v: 1, id });
const done = (id = "msg-1") => ({ type: "response.output_item.done", item: {
  type: "message", id, content: [{ type: "output_text", text: "Provider result", annotations: [{ ...source, start_index: 3, end_index: 8 }] }],
} });
function message(content: AssistantMessage["content"]): AssistantMessage {
  return { ...model, role: "assistant", content, stopReason: "stop", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

describe("native annotations", () => {
  it("ships extraction with the plugin without an installation patch", () => {
    const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { files: string[]; scripts: Record<string, string> };
    expect(metadata.files).toContain("native.ts");
    expect(metadata.scripts).not.toHaveProperty("postinstall");
  });

  it("extracts URL sources from finalized output text without unsafe offsets", () => {
    expect(extractNativeItem(done())).toEqual({ id: "msg-1", citations: [source] });
  });

  it.each([null, {}, { type: "response.output_text.delta" }, { type: "response.completed" },
    { type: "response.output_item.done", item: { type: "function_call", id: "call-1" } },
  ])("ignores non-message events: %j", (data) => {
    expect(extractNativeItem(data)).toBeUndefined();
  });

  it("collects annotations across content parts, excluding non-URL and malformed annotations", () => {
    const event = done();
    event.item.content.push({ type: "output_text", text: "More", annotations: [{ ...source, url: "https://example.org/second", start_index: 0, end_index: 1 }] });
    const raw = { ...event, item: { ...event.item, content: [...event.item.content, {
      type: "output_text", annotations: [{ type: "file_citation", url: source.url }, { type: "url_citation" }, null],
    }] } };
    expect(extractNativeItem(raw)?.citations.map((citation) => citation.url)).toEqual([source.url, "https://example.org/second"]);
    expect(extractNativeItem({ ...event, item: { ...event.item, content: [] } })).toBeUndefined();
  });

  it("binds multiple text blocks by signature ID, not their order or text", () => {
    const original = message([
      { type: "text", text: "Rewritten B", textSignature: signature("msg-2") },
      { type: "text", text: "Rewritten A", textSignature: signature("msg-1") },
    ]);
    const first = extractNativeItem(done())!;
    const second: NativeItem = { id: "msg-2", citations: [{ ...source, url: "https://example.org/second" }] };
    const pending = new Map([first, second].map((item) => [nativeKey(model, item.id), item]));
    const result = attachNative(original, pending);
    expect(result.content[0]).toMatchObject({ text: "Rewritten B", citations: second.citations });
    expect(result.content[1]).toMatchObject({ text: "Rewritten A", citations: first.citations });
    expect(original.content[0]).not.toHaveProperty("citations");
  });

  it.each([undefined, "legacy-id", "{broken", '{"v":2,"id":"msg-1"}'])("does not guess missing/unsupported signature %j", (textSignature) => {
    const original = message([{ type: "text", text: "Provider result", ...(textSignature === undefined ? {} : { textSignature }) }]);
    const item = extractNativeItem(done())!;
    expect(attachNative(original, new Map([[nativeKey(model, item.id), item]]))).toBe(original);
  });

  it("separates providers, APIs and models even when output IDs match", () => {
    const original = message([{ type: "text", text: "Provider result", textSignature: signature("msg-1") }]);
    const item = extractNativeItem(done())!;
    for (const other of [{ ...model, provider: "other" }, { ...model, api: "openai-codex-responses" }, { ...model, model: "other" }]) {
      expect(attachNative(original, new Map([[nativeKey(other, item.id), item]]))).toBe(original);
    }
  });

  it("does not duplicate host-supplied metadata", () => {
    const original = message([{ type: "text", text: "Provider result", textSignature: signature("msg-1"), citations: [source] }]);
    const item = extractNativeItem(done())!;
    expect(attachNative(original, new Map([[nativeKey(model, item.id), item]]))).toMatchObject({ content: [{ citations: [source] }] });
  });
});

describe("pending native source lifecycle", () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  function harness() {
    const handlers = new Map<string, Handler>();
    const appendEntry = vi.fn();
    extension({ on: (name: string, handler: Handler) => handlers.set(name, handler), appendEntry } as unknown as ExtensionAPI);
    const ctx = { sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext;
    const dispatch = (name: string, event: unknown) => handlers.get(name)!(event, ctx);
    dispatch("provider_stream_event", { ...model, data: done() });
    return { dispatch, appendEntry };
  }

  it("injects provenance rules covering evidence processing, responses and file content", () => {
    const { dispatch } = harness();
    const sections: Record<string, string> = { existing: "Keep this section" };
    dispatch("before_agent_start", { systemPromptOptions: { sections } });
    const rules = sections.weclio_citations!;

    expect(sections.existing).toBe("Keep this section");
    expect(rules).toContain("Apply these rules to evidence processing, responses, and file content:");
    expect(rules).toContain("retain each block’s `{ content, citation }` association where present");
    expect(rules).toContain("keep the source link or citation marker adjacent to the corresponding content");
    expect(rules).toContain("Do not replace citations with unlinked source descriptions");
    expect(rules).toContain("Use supplied markers exactly:");
    expect(rules).toContain("Preserve existing Markdown/native citations; do not convert them back into markers");
    expect(rules).toContain("Never invent citation IDs or URLs");
    expect(rules).toContain("Do not include internal source-ID mappings in deliverables");
    expect(rules).toContain("escape its opening bracket with a backslash");
  });

  it.each(["error", "aborted"] as const)("discards %s response sources before retry", (stopReason) => {
    const { dispatch, appendEntry } = harness();
    const draft = message([{ type: "text", text: "Provider result", textSignature: signature("msg-1") }]);
    dispatch("message_end", { message: { ...draft, stopReason } });
    expect(dispatch("message_end", { message: draft })).toBeUndefined();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("does not erase active annotations when a background response arrives", () => {
    const { dispatch, appendEntry } = harness();
    const background = done("msg-background");
    background.item.content[0]!.annotations[0]!.url = "https://example.org/background";
    dispatch("provider_stream_event", { ...model, data: background });
    const draft = message([{ type: "text", text: "Provider result", textSignature: signature("msg-1") }]);
    expect(dispatch("message_end", { message: draft })).toMatchObject({ message: { content: [{ citations: [source] }] } });
    expect(appendEntry).toHaveBeenCalledWith("weclio-citations", [{ source: source.title, url: source.url }]);
    expect(dispatch("message_end", { message: message([{ type: "text", text: "Next", textSignature: signature("msg-background") }]) })).toBeUndefined();
    expect(appendEntry).toHaveBeenCalledTimes(1);
  });

  it("leaves malformed native citation metadata visible without a citation error", () => {
    const { dispatch, appendEntry } = harness();
    dispatch("before_agent_start", { systemPromptOptions: { sections: {} } });
    const draft = message([{ type: "text", text: "Original conclusion", citations: [{ ...source, url: "invalid" }] }]);
    expect(dispatch("message_end", { message: draft })).toBeUndefined();
    expect(dispatch("agent_before_settle", { outcome: "completed" })).toBeUndefined();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it.each([
    '{"identifier":"fixture","blocks":[{"content":"Evidence","citation":{"source":"A","url":"invalid"}}]}',
    '{"identifier":"fixture","blocks":[{"content":"Evidence","citation":{',
  ])("preserves tool evidence instead of returning a citation error: %s", (text) => {
    const { dispatch, appendEntry } = harness();
    expect(dispatch("tool_result", { toolName: "read", isError: false, content: [{ type: "text", text }] })).toBeUndefined();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it.each(["before_agent_start", "session_start", "session_tree"])("clears pending sources on %s", (name) => {
    const { dispatch, appendEntry } = harness();
    dispatch(name, { systemPromptOptions: { sections: {} } });
    const draft = message([{ type: "text", text: "Provider result", textSignature: signature("msg-1") }]);
    expect(dispatch("message_end", { message: draft })).toBeUndefined();
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
