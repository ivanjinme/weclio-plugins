import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Real Responses SSE parsing against localhost only; no SDK patch or API credentials.
const piCli = resolve(process.env.PI_CLI ?? join(dirname(findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url)), "dist/cli.js"));
const aiRoot = dirname(findPackageJSON("@earendil-works/pi-ai", pathToFileURL(piCli).href));
assert(!readFileSync(join(aiRoot, "dist/api/openai-responses-shared.js"), "utf8").includes("slot.block.citations"), "Run this check with the unpatched workspace Pi SDK");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const search = resolve(process.env.PI_WEB_SEARCH_EXTENSION ?? join(packageRoot, "../pi-web-search/index.ts"));
const source = { type: "url_citation", title: "Raw native source", url: "https://example.org/raw?utm_source=openai" };
const otherSource = { type: "url_citation", title: "Other native source", url: "https://example.org/other" };
const link = `[${source.title}](${source.url})`;
const mapping = "Citation IDs for sources associated with this text block";

function emitResponse(res, turn, items) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const response = { id: `resp-${turn}`, model: "fixture", status: "in_progress", output: [] };
  send({ type: "response.created", response });
  items.forEach((item, output_index) => {
    send({ type: "response.output_item.added", output_index, item: { ...item, ...(item.type === "message" ? { content: [] } : { arguments: "" }) } });
    if (item.type === "message") send({ type: "response.output_text.delta", item_id: item.id, output_index, content_index: 0, delta: item.content[0].text });
    else send({ type: "response.function_call_arguments.delta", item_id: item.id, output_index, delta: item.arguments });
    send({ type: "response.output_item.done", output_index, item });
  });
  send({ type: "response.completed", response: { ...response, status: "completed", output: items,
    usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  } });
  res.end();
}
const textItem = (turn, text, annotations = []) => ({ id: `msg-${turn}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations }] });
const writeItem = (turn, path, content) => ({ id: `fc-${turn}`, type: "function_call", call_id: `call-${turn}`, name: "write", arguments: JSON.stringify({ path, content }), status: "completed" });

async function run(reverse, enabled) {
  const cwd = mkdtempSync(join(tmpdir(), "citations-native-http-"));
  let calls = 0;
  let id;
  let serverError;
  const server = createServer((req, res) => {
    void (async () => {
      req.setEncoding("utf8");
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      assert.equal(req.url, "/v1/responses");
      calls++;
      if (calls === 1) {
        emitResponse(res, calls, [
          textItem(calls, `Synthetic evidence ${link}`, [{ ...source, start_index: 19, end_index: 93 }]),
          textItem(`${calls}-other`, "Other synthetic evidence", [otherSource]),
          writeItem(calls, "seed.txt", "seed"),
        ]);
      } else if (calls === 2) {
        const context = JSON.stringify(payload.input);
        id = context.match(/\[\[cite:(c[0-9a-f]{16})\]\]/)?.[1];
        assert.equal(Boolean(id), enabled, "native source must reach the next model context only through the extension");
        assert.equal(context.includes(mapping), enabled);
        emitResponse(res, calls, [writeItem(calls, "arbitrary.output", enabled ? `Raw claim \[[cite:${id}]]` : `Raw claim ${link}`)]);
      } else {
        assert.equal(calls, 3);
        emitResponse(res, calls, [textItem(calls, enabled ? `Raw claim \[[cite:${id}]]` : `Raw claim ${link}`)]);
      }
    })().catch((error) => {
      serverError = error;
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    });
  });
  try {
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const extensions = enabled ? [search, join(packageRoot, "index.ts")] : [search];
    if (reverse) extensions.reverse();
    const args = [piCli, "--print", "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--tools", "write", "--session-dir", join(cwd, "sessions")];
    for (const extension of extensions) args.push("--extension", extension);
    args.push("--extension", join(packageRoot, "test/fixtures/http-provider.ts"), "--provider", "citations-http", "--model", "fixture", "--thinking", "off", "Exercise native citation extraction.");
    const result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, args, { cwd, env: { ...process.env, PI_WEB_SEARCH: "1", CITATIONS_HTTP_URL: `http://127.0.0.1:${server.address().port}/v1` }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => child.kill(), 45000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (status, signal) => { clearTimeout(timer); done({ status, signal, stdout, stderr }); });
    });
    assert.ifError(serverError);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${result.signal ?? ""}`);
    assert.equal(calls, 3);
    assert.equal(readFileSync(join(cwd, "arbitrary.output"), "utf8"), `Raw claim ${link}`);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    const messages = events.filter((event) => event.type === "message_end" && event.message.role === "assistant").map((event) => event.message);
    const native = messages[0].content.find((block) => block.type === "text");
    assert.equal(native.textSignature, JSON.stringify({ v: 1, id: "msg-1" }));
    assert.equal(native.text.includes("utm_source"), false);
    assert.deepEqual(native.citations, enabled ? [source] : undefined);
    const other = messages[0].content.filter((block) => block.type === "text")[1];
    assert.equal(other.textSignature, JSON.stringify({ v: 1, id: "msg-1-other" }));
    assert.deepEqual(other.citations, enabled ? [otherSource] : undefined);
    assert(!messages.flatMap((message) => message.content).some((block) => block.type === "text" && block.text.includes("\[[cite:")));
    assert(!JSON.stringify(messages).includes(mapping));
    const sessionFile = readdirSync(join(cwd, "sessions"), { recursive: true }).find((name) => name.endsWith(".jsonl"));
    const entries = readFileSync(join(cwd, "sessions", sessionFile), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const saved = entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");
    assert.deepEqual(saved.message.content.filter((block) => block.type === "text").map((block) => block.citations), enabled ? [[source], [otherSource]] : [undefined, undefined]);
    assert.equal(entries.some((entry) => entry.type === "custom" && entry.customType === "weclio-citations"), enabled);
    console.log(`PASS unpatched Responses SSE -> ${enabled ? `native metadata/context/file/chat/persistence (${reverse ? "citations first" : "search first"})` : "no metadata without citations extension (negative control)"}`);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(cwd, { recursive: true, force: true });
  }
}

await run(false, true);
await run(true, true);
await run(false, false);
