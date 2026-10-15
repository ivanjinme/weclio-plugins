import type { AssistantMessage, Citation as NativeCitation } from "@earendil-works/pi-ai";

// 由插件填充的元数据，不修改宿主依赖的文件。
declare module "@earendil-works/pi-ai" {
  interface Citation {
    type: "url_citation";
    url: string;
    title?: string;
    startIndex?: number;
    endIndex?: number;
  }
  interface TextContent {
    citations?: Citation[];
  }
}

export interface NativeItem {
  id: string;
  citations: NativeCitation[];
}

type RawAnnotation = { type?: string; url?: unknown; title?: unknown };
type RawPart = { type?: string; annotations?: RawAnnotation[] };
type RawEvent = { type?: string; item?: { type?: string; id?: string; content?: RawPart[] } };

export function extractNativeItem(data: unknown): NativeItem | undefined {
  const event = data as RawEvent | null;
  const item = event?.item;
  if (event?.type !== "response.output_item.done" || item?.type !== "message" || typeof item.id !== "string" || !Array.isArray(item.content)) return;
  const citations = item.content.flatMap((part) => part?.type === "output_text" && Array.isArray(part.annotations) ? part.annotations.flatMap((annotation): NativeCitation[] => {
    if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") return [];
    // 只消费来源信息；偏移可能因其他扩展改写正文而失效。
    return [{ type: "url_citation", url: annotation.url, ...(typeof annotation.title === "string" ? { title: annotation.title } : {}) }];
  }) : []);
  return citations.length ? { id: item.id, citations } : undefined;
}

export function nativeKey(model: { provider: string; api: string; model: string }, id: string): string {
  return JSON.stringify([model.provider, model.api, model.model, id]);
}

function signatureId(signature: string | undefined): string | undefined {
  if (!signature?.startsWith("{")) return;
  let value: { v?: unknown; id?: unknown } | null;
  try { value = JSON.parse(signature); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return;
  }
  // Pi 1.0.2 的 Responses textSignature；不按正文或输出顺序猜测归属。
  return value?.v === 1 && typeof value.id === "string" ? value.id : undefined;
}

export function attachNative(message: AssistantMessage, pending: ReadonlyMap<string, NativeItem>): AssistantMessage {
  const content = message.content.map((block) => {
    if (block.type !== "text") return block;
    const id = signatureId(block.textSignature);
    const item = id === undefined ? undefined : pending.get(nativeKey(message, id));
    return item ? { ...block, citations: item.citations } : block;
  });
  return content.every((block, i) => block === message.content[i]) ? message : { ...message, content };
}
