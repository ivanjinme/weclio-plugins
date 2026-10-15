import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function httpProvider(pi: ExtensionAPI): void {
  pi.registerProvider("citations-http", {
    api: "openai-responses", baseUrl: process.env.CITATIONS_HTTP_URL!, apiKey: "fixture",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 1000 }],
  });
}
