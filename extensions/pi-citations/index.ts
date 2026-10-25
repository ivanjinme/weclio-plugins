import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { annotateCli, citationId, CitationError, hasCitationMarker, register, render, type Citation, type Registry } from "./citations.js";

import { attachNative, extractNativeItem, nativeKey, type NativeItem } from "./native.js";

const ENTRY = "weclio-citations";
const MAX_RETRIES = 2;
const RULES = "Cite supporting evidence beside each claim. When that evidence supplies a citation marker, use it exactly, including in file content. Citation markers require two pairs of square brackets: [[cite:ID]]. Preserve citations when rewriting. Never invent citation IDs or URLs. Preserve existing Markdown/native citations; do not convert them back into markers. For literal citation-marker examples, escape the opening bracket with a backslash. Do not include internal source-ID mappings in delivered content.";

export default function weclioCitations(pi: ExtensionAPI): void {
  let registry: Registry = new Map();
  const pendingNative = new Map<string, NativeItem>();
  let chatError: { error: CitationError; draft: TextContent[] } | undefined;
  let chatRetries = 0;

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    registry = new Map();
    pendingNative.clear();
    chatError = undefined;
    chatRetries = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY) {
        for (const citation of entry.data as Citation[]) register(registry, citation);
      }
    }
  };
  const commit = (next: Registry) => {
    const added = [...next].filter(([id]) => !registry.has(id)).map(([, citation]) => citation);
    if (added.length) pi.appendEntry(ENTRY, added);
    registry = next;
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("before_agent_start", (event) => {
    pendingNative.clear();
    chatError = undefined;
    chatRetries = 0;
    event.systemPromptOptions.sections.weclio_citations = RULES;
  });

  pi.on("provider_stream_event", (event) => {
    const item = extractNativeItem(event.data);
    if (item) pendingNative.set(nativeKey(event, item.id), item);
  });

  pi.on("tool_result", (event) => {
    if (event.isError || !["bash", "read"].includes(event.toolName)) return;
    const next = new Map(registry);
    try {
      const content = event.content.map((block) => {
        if (block.type !== "text") return block;
        const text = annotateCli(block.text, (citation) => register(next, citation));
        return text === block.text ? block : { ...block, text };
      });
      commit(next);
      if (content.every((block, i) => block === event.content[i])) return;
      return { content, ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }) };
    } catch (error) {
      if (!(error instanceof CitationError)) throw error;
      // Unusable citation metadata must not hide the original tool evidence.
      return;
    }
  });

  pi.on("context", (event) => {
    if (!registry.size) return;
    const messages = event.messages.map((message) => {
      if (message.role !== "assistant") return message;
      const content = message.content.map((block) => {
        if (block.type !== "text" || !block.citations?.length) return block;
        const sources = block.citations.map((citation) => {
          const source = { source: citation.title || citation.url, url: citation.url };
          const id = citationId(source);
          return registry.has(id) ? `${JSON.stringify(source.source)} [[cite:${id}]]` : undefined;
        }).filter(Boolean);
        return sources.length ? {
          ...block,
          text: `${block.text}\n\nCitation IDs for sources associated with this text block (choose the source supporting your claim):\n${[...new Set(sources)].join("\n")}`,
        } : block;
      });
      return { ...message, content };
    });
    return { messages };
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const input = event.input as { content?: string; edits?: { oldText: string; newText: string }[] };
    const texts = event.toolName === "write" ? [input.content!] : input.edits!.map((edit) => edit.newText);
    if (!texts.some((text) => text.includes("[[cite:"))) return;
    const rendered = texts.map((text) => render(text, registry, () => {}));
    if (event.toolName === "write") input.content = rendered[0]!;
    else input.edits = input.edits!.map((edit, i) => ({ ...edit, newText: rendered[i]! }));
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const message = attachNative(event.message, pendingNative);
    pendingNative.clear();
    if (["error", "aborted"].includes(message.stopReason)) return;
    const next = new Map(registry);
    for (const block of message.content) {
      if (block.type !== "text") continue;
      for (const citation of block.citations ?? []) {
        try { register(next, { source: citation.title || citation.url, url: citation.url }); }
        catch (error) { if (!(error instanceof CitationError)) throw error; }
      }
    }
    commit(next);

    let error: CitationError | undefined;
    let content = message.content.map((block) => {
      if (block.type !== "text") return block;
      const text = render(block.text, registry, (failure) => { error ??= failure; });
      if (text === block.text) return block;
      // Text length changed; retain sources, not stale provider offsets.
      const citations = block.citations?.map(({ type, url, title }) => ({ type, url, ...(title === undefined ? {} : { title }) }));
      return { ...block, text, ...(citations === undefined ? {} : { citations }) };
    });
    const final = message.stopReason === "stop";
    if (chatError && final && !content.some((block) => block.type === "text" &&
      (hasCitationMarker(block.text) || block.citations?.length || /\[[^\n]+\]\(https?:\/\/[^\s)]+\)/.test(block.text)))) {
      // A citation-free retry is not a repair; keep the draft with visible markers.
      error = new CitationError("MISSING_CITATION", [], "Restore the citations without changing the draft's conclusions.");
      chatError.error = error;
      content = chatError.draft;
    } else if (error) {
      chatError = { error, draft: content.filter((block): block is TextContent => block.type === "text") };
    }

    if (final) {
      if (!error) chatError = undefined;
      else if (chatRetries < MAX_RETRIES) {
        return { message: { ...message, content: [] } };
      } else {
        chatError = undefined;
      }
    }
    if (content.length === message.content.length && content.every((block, i) => block === message.content[i])) {
      return message === event.message ? undefined : { message };
    }
    return { message: { ...message, content } };
  });

  pi.on("agent_before_settle", (event) => {
    if (!chatError || chatRetries >= MAX_RETRIES || event.outcome !== "completed") return;
    chatRetries++;
    const { error, draft } = chatError;
    return {
      entries: [{ type: "custom_message" as const, customType: `${ENTRY}-repair`, display: false,
        content: JSON.stringify({ error: error.code, ids: error.ids,
          action: "Fix missing or invalid citations only. Preserve the draft's wording and conclusions. Do not remove citation markers to evade repair or invent IDs or URLs.",
          draft: draft.map((block) => block.text).join("\n"),
        }),
      }],
      continue: true,
    };
  });
}
