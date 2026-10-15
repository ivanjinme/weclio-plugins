import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import register from "../src/index.js";
import { runSubagent, runSubagentResume } from "../src/runner.js";

const tempRoots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-submarine-sdk-seam-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi SDK integration seam", () => {
  it.each(["fresh", "fork"] as const)("inherits runtime-only API keys for %s children and resume without persisting them", async (context) => {
    const root = await tempRoot();
    const cwd = path.join(root, "project");
    const agentDir = path.join(root, "agent-dir");
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    let expectedKey = "submarine-runtime-only-test-key";
    const authorizations: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      request.resume();
      request.on("end", () => {
        if (request.headers.authorization !== `Bearer ${expectedKey}`) {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "authenticated child" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected TCP server");
      const provider = "submarine-auth-fixture";
      await writeFile(path.join(agentDir, "models.json"), JSON.stringify({ providers: {
        [provider]: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", authHeader: true, models: [{ id: "fixture" }] },
      } }));
      await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"),
      });
      await runtime.setRuntimeApiKey(provider, expectedKey);
      const model = runtime.getModel(provider, "fixture");
      expect(model).toBeDefined();
      const parent = SessionManager.create(cwd, path.join(root, "sessions"));
      parent.appendModelChange(provider, "fixture");
      parent.appendMessage({ role: "user", content: "Parent request", timestamp: Date.now() });
      // Materialize the parent session so fork can reopen it.
      parent.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }],
        api: model!.api, provider, model: "fixture", stopReason: "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      });
      const ctx = { cwd, sessionManager: parent, model, modelRegistry: new ModelRegistry(runtime) } as unknown as ExtensionContext;
      const options = { deps: { getAgentDir: () => agentDir } };
      const result = await runSubagent({ task: "Reply briefly", context }, undefined, undefined, ctx, options);
      expect(result.details.run.status).toBe("completed");
      expect(result.content[0]?.text).toContain("authenticated child");

      expectedKey = "submarine-rotated-runtime-test-key";
      await runtime.setRuntimeApiKey(provider, expectedKey);
      const resumed = await runSubagentResume({ sessionId: result.details.run.sessionId, message: "Continue" }, undefined, undefined, ctx, options);
      expect(resumed.details.run.status).toBe("completed");
      expect(resumed.content[0]?.text).toContain("authenticated child");
      expect(authorizations).toEqual(["Bearer submarine-runtime-only-test-key", `Bearer ${expectedKey}`]);
      expect(JSON.parse(await readFile(path.join(agentDir, "auth.json"), "utf8"))).toEqual({});
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);

  it("creates a persisted child AgentSession and binds pi-submarine tools from the inline extension factory", async () => {
    const root = await tempRoot();
    const cwd = path.join(root, "project");
    const agentDir = path.join(root, "agent-dir");
    const subagentsDir = path.join(root, "parent.jsonl.subagents");
    const sessionManager = SessionManager.create(cwd, subagentsDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noContextFiles: true,
      extensionFactories: [register],
    });

    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager });

    try {
      await session.bindExtensions({ onError: (error) => { throw error; } });

      expect(sessionManager.getSessionFile()).toMatch(new RegExp(`${escapeRegExp(subagentsDir)}[/\\\\].+\\.jsonl$`));
      expect(session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["subagent", "subagent_resume", "subagent_list"]));
      expect(resourceLoader.getExtensions().errors).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("loads project-local extension tools when child resources are explicitly project-trusted", async () => {
    const root = await tempRoot();
    const cwd = path.join(root, "project");
    const agentDir = path.join(root, "agent-dir");
    const subagentsDir = path.join(root, "parent.jsonl.subagents");
    const extensionPath = path.join(cwd, ".pi", "extensions", "project-tool.js");
    await mkdir(path.dirname(extensionPath), { recursive: true });
    await writeFile(extensionPath, `
export default function(pi) {
  pi.registerTool({
    name: "project_tool",
    label: "Project Tool",
    description: "A project-local test tool",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; }
  });
}
`, "utf8");

    const sessionManager = SessionManager.create(cwd, subagentsDir);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noContextFiles: true });

    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager });

    try {
      await session.bindExtensions({ onError: (error) => { throw error; } });

      expect(settingsManager.isProjectTrusted()).toBe(true);
      expect(session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["project_tool"]));
      expect(resourceLoader.getExtensions().errors).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("branches a reopened parent session into the parent-local .subagents directory", async () => {
    const root = await tempRoot();
    const cwd = path.join(root, "project with spaces");
    const sessionsDir = path.join(root, "sessions");
    const subagentsDir = path.join(root, "parent.jsonl.subagents");
    await mkdir(cwd, { recursive: true });

    const parent = SessionManager.create(cwd, sessionsDir);
    const userId = parent.appendMessage({ role: "user", content: "Remember blue." } as Parameters<SessionManager["appendMessage"]>[0]);
    const assistantId = parent.appendMessage({ role: "assistant", content: "I will remember blue.", stopReason: "stop" } as unknown as Parameters<SessionManager["appendMessage"]>[0]);
    const parentSessionFile = parent.getSessionFile();
    if (!parentSessionFile) throw new Error("expected parent session file");

    const source = SessionManager.open(parentSessionFile, subagentsDir);
    const originalSourceSessionFile = source.getSessionFile();
    const originalParentSessionFile = parent.getSessionFile();
    const childSessionFile = source.createBranchedSession(parent.getLeafId() ?? "");
    if (!childSessionFile) throw new Error("expected child session file");

    const childLines = (await readFile(childSessionFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string; id?: string; cwd?: string; parentSession?: string });
    const header = childLines[0];
    const entries = childLines.slice(1);

    expect(path.dirname(childSessionFile)).toBe(subagentsDir);
    expect(path.basename(childSessionFile)).toMatch(/\.jsonl$/);
    expect(header).toMatchObject({ type: "session", cwd: path.resolve(cwd), parentSession: parentSessionFile });
    expect(entries.map((entry) => entry.id)).toEqual([userId, assistantId]);
    expect(source.getSessionFile()).toBe(childSessionFile);
    expect(source.getSessionFile()).not.toBe(originalSourceSessionFile);
    expect(parent.getSessionFile()).toBe(originalParentSessionFile);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
