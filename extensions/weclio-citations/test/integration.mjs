import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { findPackageJSON } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

// Uses the workspace Pi by default. No provider network calls.
const piCli = process.env.PI_CLI ?? join(dirname(findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url)), "dist/cli.js");
const aiPackage = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(resolve(piCli)).href);
const aiModule = join(dirname(aiPackage), "dist/utils/event-stream.js");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(packageRoot, "index.ts");
const provider = join(packageRoot, "test/fixtures/provider.ts");
const nativeExtension = process.env.PI_WEB_SEARCH_EXTENSION ?? resolve(packageRoot, "../pi-web-search/index.ts");
const root = mkdtempSync(join(tmpdir(), "weclio-citations-"));
const cliCitation = { source: "CLI report", source_id: "study-1", url: "https://example.org/cli" };
const fixture = { identifier: { RecordType: "CAS", RecordNumber: "31570-04-4", RecordTitle: "Fixture" }, blocks: [{ content: "# Heading" }, { content: "CLI evidence.", citation: cliCitation }] };

function run(mode, extra = [], citations = true) {
  const cwd = join(root, mode);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "fixture.json"), JSON.stringify(["fallback", "standalone"].includes(mode) ? { content: "CLI evidence.", citation: cliCitation } : fixture));
  writeFileSync(join(cwd, "arbitrary.output"), mode === "edit-atomic" ? "FIRST\nSECOND" : "ORIGINAL");
  const log = join(cwd, "requests.jsonl");
  writeFileSync(log, "");
  const args = [resolve(piCli), "--print", "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--tools", "read,write,edit"];
  if (nativeExtension && mode !== "reverse") args.push("--extension", resolve(nativeExtension));
  if (citations) args.push("--extension", extension);
  if (nativeExtension && mode === "reverse") args.push("--extension", resolve(nativeExtension));
  args.push("--extension", provider, "--provider", "citations-fixture", "--model", "fixture", "--thinking", "off");
  if (mode === "mix") args.push("--session-dir", join(cwd, "sessions"));
  else if (mode !== "restore") args.push("--no-session");
  args.push(...extra, "Exercise citation hooks.");
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 30000,
    env: { ...process.env, PI_WEB_SEARCH: mode === "search-disabled" ? "0" : "1", CITATIONS_AI_MODULE: aiModule, CITATIONS_TEST_MODE: mode, CITATIONS_TEST_LOG: log },
  });
  assert.ifError(result.error);
  const events = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const observations = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const requests = observations.filter((item) => item.kind === "request");
  const messages = events.filter((event) => event.type === "message_end").map((event) => event.message);
  return { result, cwd, requests, messages, file: readFileSync(join(cwd, "arbitrary.output"), "utf8") };
}
const finalText = (run) => run.messages.filter((message) => message.role === "assistant").at(-1)?.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
const errors = (run) => run.messages.filter((message) => message.role === "toolResult" && message.isError);
const rules = (request, section = "weclio_citations") => request.messages.filter((message) => message.role === "system" && message.sections?.[section]).map((message) => message.sections[section]);
const mapping = "Citation IDs for sources associated with this text block";

try {
  const mixed = run("mix");
  assert.equal(mixed.result.status, 0, mixed.result.stderr);
  assert.equal(mixed.requests.length, 5);
  assert.equal(mixed.requests[1].ids.length, 2);
  assert.equal(mixed.requests[0].ids.length, 0);
  assert.equal(rules(mixed.requests[0]).length, 1);
  assert(rules(mixed.requests[0])[0].includes("When that evidence supplies a citation marker, use it exactly"));
  assert(rules(mixed.requests[0])[0].includes("escape the opening bracket"));
  assert(mixed.requests.every((request) => rules(request).length === 1));
  assert(mixed.requests.every((request) => !request.messages.some((message) => message.role !== "system" && JSON.stringify(message.content).includes("Never invent citation IDs or URLs"))));
  assert(JSON.stringify(mixed.requests[1].messages).includes(mapping));
  assert(!mixed.file.includes(mapping));
  assert(!finalText(mixed).includes(mapping));
  assert(!mixed.messages.some((message) => JSON.stringify(message.content).includes(mapping)));
  console.log("PASS system citation rules apply from the first request without context-rule messages or duplicate injection");
  assert(mixed.file.includes("[CLI report](https://example.org/cli)"));
  assert(mixed.file.includes("[Native report](https://example.org/native?utm_source=openai)"));
  assert(mixed.file.includes("\nEdited "));
  assert(mixed.file.endsWith("\nTail"));
  assert(!mixed.file.includes("[[cite:"));
  assert(!finalText(mixed).includes("[[cite:"));
  const nativeMetadata = mixed.messages.filter((message) => message.role === "assistant").at(-1).content[0].citations[0];
  assert.equal(nativeMetadata.url, "https://example.org/native?utm_source=openai");
  assert(!("startIndex" in nativeMetadata));
  assert(!("endIndex" in nativeMetadata));
  assert.equal(errors(mixed).length, 0);
  const readBack = mixed.messages.filter((message) => message.role === "toolResult" && message.toolName === "read").at(-1);
  assert.equal(readBack.content[0].text, mixed.file);
  console.log("PASS mixed native/CLI -> context -> arbitrary-path write/edit -> final render; report read is untouched");

  const sessionFile = readdirSync(join(mixed.cwd, "sessions"), { recursive: true }).find((name) => name.endsWith(".jsonl"));
  assert(sessionFile);
  const saved = join(mixed.cwd, "sessions", sessionFile);
  const entries = readFileSync(saved, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert(entries.some((entry) => entry.type === "custom" && entry.customType === "weclio-citations"));
  process.env.CITATIONS_TEST_ID = mixed.requests[1].ids[0];
  const restored = run("restore", ["--session", saved]);
  assert.equal(restored.result.status, 0, restored.result.stderr);
  assert.equal(restored.requests.length, 1);
  assert(finalText(restored).includes("[Native report]"));
  console.log("PASS persisted registry restores native citation IDs without a repair round");

  const { SessionManager } = await import(pathToFileURL(join(dirname(resolve(piCli)), "index.js")).href);
  const manager = SessionManager.open(saved);
  manager.appendCompaction(`Retained source [[cite:${process.env.CITATIONS_TEST_ID}]]`, null, 1000);
  const compacted = run("restore", ["--session", saved]);
  assert.equal(compacted.requests.length, 1);
  assert(finalText(compacted).includes("[Native report]"));
  console.log("PASS compaction does not lose the branch registry");

  const firstUser = manager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
  manager.branch(firstUser.id);
  manager.appendMessage({ role: "user", content: "New branch before evidence collection.", timestamp: Date.now() });
  const branched = run("restore", ["--session", saved]);
  assert.equal(branched.requests.length, 3);
  assert.equal(finalText(branched), `Restored [[cite:${process.env.CITATIONS_TEST_ID}]]`);
  console.log("PASS a branch before research cannot resolve IDs from abandoned research");

  const chat = run("chat");
  assert.equal(chat.result.status, 0, chat.result.stderr);
  assert.equal(chat.requests.length, 3);
  assert(finalText(chat).includes("[CLI report]"));
  assert(!chat.messages.some((message) => message.role === "assistant" && message.content.some((block) => block.text?.includes("c7"))));
  assert(chat.requests[2].messages.some((message) => JSON.stringify(message.content).includes("UNKNOWN_CITATION_ID")));
  console.log("PASS chat failure -> hidden structured repair -> valid final answer");

  const dropped = run("chat-drop");
  assert.equal(dropped.requests.length, 4);
  assert(finalText(dropped).includes("[CLI report]"));
  assert(dropped.requests[3].messages.some((message) => JSON.stringify(message.content).includes("MISSING_CITATION")));
  assert(!dropped.messages.some((message) => message.role === "assistant" && message.content.some((block) => block.text === "Citation-free rewrite.")));
  console.log("PASS repair cannot silently drop all citations to evade validation");

  const chatLimit = run("chat-limit");
  assert.equal(chatLimit.requests.length, 4); // evidence + original answer + two repairs
  assert.equal(finalText(chatLimit), "Draft [CLI report](https://example.org/cli) [[cite:c7]]");
  assert.equal(chatLimit.messages.filter((message) => message.role === "assistant").at(-1).stopReason, "stop");
  assert.equal(chatLimit.result.status, 0, chatLimit.result.stderr);
  console.log("PASS two failed repairs deliver the draft with valid links and unresolved markers, not an error");

  for (const mode of ["chat-drop-limit", "chat-tool"]) {
    const fallback = run(mode);
    assert.equal(fallback.requests.length, mode === "chat-tool" ? 6 : 4);
    assert.equal(finalText(fallback), "Draft [CLI report](https://example.org/cli) [[cite:c7]]");
    assert.equal(fallback.result.status, 0, fallback.result.stderr);
  }
  console.log("PASS citation-free retries and intervening tool calls retain the unresolved draft");

  const write = run("write");
  assert.equal(write.result.status, 0, write.result.stderr);
  assert.equal(errors(write).length, 0);
  assert.equal(write.requests.length, 3);
  assert.equal(write.file, "Draft [CLI report](https://example.org/cli) [[cite:c7]] [[cite:broken]");
  console.log("PASS write renders valid citations and preserves unknown/broken markers without blocking or retrying");

  const edited = run("edit-atomic");
  assert.equal(edited.result.status, 0, edited.result.stderr);
  assert.equal(errors(edited).length, 0);
  assert.equal(edited.requests.length, 3);
  assert.equal(edited.file, "First [CLI report](https://example.org/cli)\nSecond [[cite:c7]]");
  console.log("PASS multi-edit renders valid citations, retains unresolved markers and preserves exact oldText matching");

  const ordinary = run("ordinary");
  assert.equal(ordinary.result.status, 0, ordinary.result.stderr);
  assert.equal(ordinary.file, "Plain [existing](https://example.org/).");
  console.log("PASS ordinary writes and existing Markdown are unchanged");

  const repeated = run("ordinary", ["A second independent user prompt."]);
  assert.equal(repeated.requests.length, 3);
  assert(repeated.requests.every((request) => rules(request).length === 1));
  console.log("PASS repeated user runs retain one system citation section");

  if (nativeExtension) {
    for (const result of [mixed, repeated, run("reverse")]) {
      assert(result.requests.every((request) => rules(request).length === 1));
      assert(result.requests.every((request) => rules(request, "web_search").length === 1));
      assert(result.requests.every((request) => request.messages.some((message) => message.role === "system" && message.sections?.preamble)));
    }
    const appended = run("ordinary", ["--append-system-prompt", "User addendum sentinel."]);
    assert(appended.requests.every((request) => rules(request, "addendum").some((text) => text.includes("User addendum sentinel.") && !text.includes("## Web Search"))));
    assert(appended.requests.every((request) => rules(request, "web_search").length === 1));
    const disabled = run("search-disabled");
    assert.equal(disabled.requests.length, 2);
    assert(disabled.requests.every((request) => rules(request).length === 1 && rules(request, "web_search").length === 0));
    console.log("PASS search/citation incremental prompts coexist in both load orders, deduplicate across runs, and respect search disablement");
  }

  const literal = run("literal");
  assert.equal(literal.requests.length, 2);
  assert.equal(errors(literal).length, 0);
  assert.equal(literal.file, "Example: \\[[cite:ID]]");
  assert.equal(finalText(literal), literal.file);
  console.log("PASS escaped syntax examples pass through chat and file writes without repair");

  for (const mode of ["fallback", "standalone"]) {
    const fallback = run(mode, [], mode !== "standalone");
    assert.equal(fallback.requests.length, 3);
    assert(fallback.requests.every((request) => request.ids.length === 0));
    assert.equal(errors(fallback).length, 0);
    assert.equal(fallback.file, "CLI claim [CLI report](https://example.org/cli)");
    assert.equal(finalText(fallback), fallback.file);
    assert.equal(rules(fallback.requests[0]).length, mode === "standalone" ? 0 : 1);
  }
  console.log("PASS marker-free CLI Markdown fallback works with and without the citation extension");
} finally {
  delete process.env.CITATIONS_TEST_ID;
  rmSync(root, { recursive: true, force: true });
}
