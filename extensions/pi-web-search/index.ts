import type { Api } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ToolDefinition = Record<string, unknown>;
type NativeSearchApi =
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses";

const NATIVE_SEARCH_APIS: ReadonlySet<Api> = new Set<NativeSearchApi>([
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);
const ENABLE_ENV = "PI_WEB_SEARCH";
const WEB_SEARCH_SOURCES_INCLUDE = "web_search_call.action.sources";
const STATUS_KEY = "web-search";
const WIDGET_KEY = "web-search";

function parseEnableEnv(envVar: string): boolean {
  const envValue = process.env[envVar];
  if (!envValue) return true;

  const normalized = envValue.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNativeSearchApi(api: Api | undefined): api is NativeSearchApi {
  return api !== undefined && NATIVE_SEARCH_APIS.has(api);
}

function isNativeWebSearchType(
  value: unknown,
): value is "web_search" | "web_search_preview" {
  return value === "web_search" || value === "web_search_preview";
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
  const sanitized: ToolDefinition[] = [];
  for (const tool of tools) {
    if (!isRecord(tool)) continue;

    const isFunctionWebSearch =
      tool.name === "web_search" && !isNativeWebSearchType(tool.type);
    if (!isFunctionWebSearch) sanitized.push(tool);
  }
  return sanitized;
}

function includeWebSearchSources(payload: Record<string, unknown>): string[] {
  const include = Array.isArray(payload.include)
    ? payload.include.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return include.includes(WEB_SEARCH_SOURCES_INCLUDE)
    ? include
    : [...include, WEB_SEARCH_SOURCES_INCLUDE];
}

export function addNativeWebSearchToPayload(
  api: Api | undefined,
  payload: unknown,
): unknown {
  if (!isNativeSearchApi(api) || !isWebSearchEnabled() || !isRecord(payload)) {
    return payload;
  }

  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const sanitizedTools = sanitizeTools(tools);
  const hasNativeWebSearch = sanitizedTools.some((tool) =>
    isNativeWebSearchType(tool.type),
  );

  if (!hasNativeWebSearch) sanitizedTools.push({ type: "web_search" });

  return {
    ...payload,
    tools: sanitizedTools,
    include: includeWebSearchSources(payload),
  };
}

export function isWebSearchEnabled(): boolean {
  return parseEnableEnv(ENABLE_ENV);
}

function removeOpenAiUtmSource(text: string): string {
  return text.replace(
    /([?&])utm_source=openai(?:&|(?=[\s)\]}>,#]|$))/g,
    (match, separator: string) => (match.endsWith("&") ? separator : ""),
  );
}

function clearUi(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export const WEB_SEARCH_SECTION = `
## Web Search

Native web search is available.
Search when freshness, factual uncertainty, external verification, or evidence quality matters.
For evidence-based claims, prefer higher-quality evidence and authoritative sources.
`;

export default function webSearchExtension(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) =>
    addNativeWebSearchToPayload(ctx.model?.api, event.payload),
  );

  pi.on("session_start", (_event, ctx) => clearUi(ctx));
  pi.on("model_select", (_event, ctx) => clearUi(ctx));
  pi.on("session_shutdown", (_event, ctx) => clearUi(ctx));

  pi.on("before_agent_start", (event, ctx) => {
    if (!isNativeSearchApi(ctx.model?.api) || !isWebSearchEnabled()) return;
    return {
      systemPrompt: `${event.systemPrompt}\n${WEB_SEARCH_SECTION}`,
    };
  });

  pi.on("message_end", (event, ctx) => {
    if (
      event.message.role !== "assistant" ||
      !isNativeSearchApi(ctx.model?.api) ||
      !isWebSearchEnabled()
    )
      return;

    let changed = false;
    const content = event.message.content.map((part) => {
      if (part.type !== "text") return part;

      const text = removeOpenAiUtmSource(part.text);
      if (text === part.text) return part;

      changed = true;
      return { ...part, text };
    });

    if (changed) return { message: { ...event.message, content } };
  });
}
