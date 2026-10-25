import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Scripted provider: exercises real Pi hooks without API calls or credentials.
export default async function fixtureProvider(pi: any) {
  const { createAssistantMessageEventStream } = await import(pathToFileURL(process.env.CITATIONS_AI_MODULE!).href);
  const mode = process.env.CITATIONS_TEST_MODE!;
  let calls = 0;
  const log = (data: unknown) => appendFileSync(process.env.CITATIONS_TEST_LOG!, JSON.stringify(data) + "\n");
  const text = (value: string) => ({ type: "text", text: value });
  const call = (name: string, args: unknown) => ({ type: "toolCall", id: `call-${calls}`, name, arguments: args });
  pi.registerProvider("citations-fixture", {
    api: "openai-codex-responses", baseUrl: "https://example.invalid", apiKey: "fixture",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 1000 }],
    streamSimple(model: any, context: any, options: any) {
      const stream = createAssistantMessageEventStream();
      calls++;
      const messages = context.messages.map((message: any) => ({
        role: message.role, content: message.content, ...(message.sections ? { sections: message.sections } : {}),
      }));
      const contextText = JSON.stringify(messages);
      const ids = [...new Set([...contextText.matchAll(/\[\[cite:(c[0-9a-f]{16})\]\]/g)].map((match) => match[1]))];
      log({ kind: "request", calls, messages, ids,
        file: existsSync("arbitrary.output") ? readFileSync("arbitrary.output", "utf8") : null,
      });
      let content: any[];
      if (mode === "mix") {
        if (calls === 1) content = [{
          ...text("Native evidence. [Native report](https://example.org/native?utm_source=openai)"),
          citations: [{ type: "url_citation", title: "Native report", url: "https://example.org/native?utm_source=openai", startIndex: 17, endIndex: 75 }],
        }, call("read", { path: "fixture.json" })];
        else if (calls === 2) content = [call("write", { path: "arbitrary.output", content: `Mixed ${ids.map((id) => `[[cite:${id}]]`).join(" ")}\nA\nB` })];
        else if (calls === 3) content = [call("edit", { path: "arbitrary.output", edits: [
          { oldText: "\nA", newText: `\nEdited [[cite:${ids[0]}]]` },
          { oldText: "\nB", newText: "\nTail" },
        ] })];
        else if (calls === 4) content = [call("read", { path: "arbitrary.output" })];
        else content = [{ ...text(`Mixed ${ids.map((id) => `[[cite:${id}]]`).join(" ")}`),
          citations: [{ type: "url_citation", title: "Native report", url: "https://example.org/native?utm_source=openai", startIndex: 5, endIndex: 30 }],
        }];
      } else if (mode === "restore") {
        content = [text(`Restored [[cite:${process.env.CITATIONS_TEST_ID}]]`)];
      } else if (mode === "edit-atomic") {
        if (calls === 1) content = [call("read", { path: "fixture.json" })];
        else if (calls === 2) content = [call("edit", { path: "arbitrary.output", edits: [
          { oldText: "FIRST", newText: `First [[cite:${ids[0]}]]` },
          { oldText: "SECOND", newText: "Second [[cite:c7]]" },
        ] })];
        else content = [text("DONE")];
      } else if (["ordinary", "reverse", "search-disabled"].includes(mode)) {
        content = calls === 1 ? [call("write", { path: "arbitrary.output", content: "Plain [existing](https://example.org/)." })] : [text("DONE")];
      } else if (mode === "literal") {
        const example = "Example: \\[[cite:ID]] and \\[cite:ID]; ordinary [1] [2].";
        content = calls === 1 ? [call("write", { path: "arbitrary.output", content: example })] : [text(example)];
      } else if (calls === 1) {
        content = [call("read", { path: "fixture.json" })];
      } else if (["fallback", "standalone"].includes(mode)) {
        const { citation } = JSON.parse(readFileSync("fixture.json", "utf8"));
        const claim = `CLI claim [${citation.source}](${citation.url})`;
        content = calls === 2 ? [call("write", { path: "arbitrary.output", content: claim })] : [text(claim)];
      } else if (mode === "markdown") {
        const markdown = `Link [cite:${ids[0]}](https://example.org/inline).`;
        content = calls === 2 ? [call("write", { path: "arbitrary.output", content: markdown })] : [text(markdown)];
      } else if (mode === "single-file") {
        if (calls === 2) content = [call("write", {
          path: "arbitrary.output", content: `Single [cite:${ids[0]}]; double [[cite:${ids[0]}]].\nTAIL`,
        })];
        else if (calls === 3) content = [call("edit", { path: "arbitrary.output", edits: [
          { oldText: "TAIL", newText: `Edited [cite:${ids[0]}]; double [[cite:${ids[0]}]].` },
        ] })];
        else content = [text("DONE")];
      } else if (["chat-single", "chat-single-limit", "chat-single-drop", "chat-single-mixed"].includes(mode)) {
        const fixed = mode === "chat-single" && calls > 2 || mode === "chat-single-drop" && calls > 3;
        const draft = mode === "chat-single-mixed"
          ? `Draft [[cite:${ids[0]}]] [cite:${ids[0]}]`
          : `Draft [cite:${ids[0]}]`;
        content = [text(fixed ? `Fixed [[cite:${ids[0]}]]`
          : mode === "chat-single-drop" && calls === 3 ? "Citation-free rewrite." : draft)];
      } else if (["chat", "chat-limit", "chat-drop", "chat-drop-limit", "chat-tool"].includes(mode)) {
        const fixed = mode === "chat" && calls > 2 || mode === "chat-drop" && calls > 3;
        content = [text(fixed ? `Fixed [[cite:${ids[0]}]]` : (mode === "chat-drop" && calls === 3 || mode === "chat-drop-limit" && calls > 2 || mode === "chat-tool" && calls > 2) ? "Citation-free rewrite." : `Draft [[cite:${ids[0]}]] [[cite:c7]]`)];
        if (mode === "chat-tool" && calls <= 3) content.push(call("read", { path: "fixture.json" }));
      } else {
        content = calls > 2 ? [text("DONE")] : [call("write", {
          path: "arbitrary.output", content: `Draft [[cite:${ids[0]}]] [[cite:c7]] [[cite:broken]`,
        })];
      }
      const rawEvents: unknown[] = [];
      content = content.map((block, index) => {
        if (block.type !== "text" || !block.citations?.length) return block;
        const { citations, ...normalized } = block;
        const id = `msg-${calls}-${index}`;
        rawEvents.push({ type: "response.output_item.done", item: { type: "message", id, content: [{
          type: "output_text", text: block.text,
          annotations: citations.map(({ startIndex, endIndex, ...citation }: any) => ({ ...citation, start_index: startIndex, end_index: endIndex })),
        }] } });
        return { ...normalized, textSignature: JSON.stringify({ v: 1, id }) };
      });
      const message = {
        role: "assistant", content, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
      };
      void (async () => {
        await options?.onPayload?.({ model: model.id }, model);
        stream.push({ type: "start", partial: message });
        for (const event of rawEvents) await options?.onProviderStreamEvent?.(event, model);
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
      })().catch((error) => {
        stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: String(error) } });
        stream.end();
      });
      return stream;
    },
  });
  pi.on("tool_call", (event: any) => log({ kind: "tool_call", name: event.toolName, input: event.input }));
}
