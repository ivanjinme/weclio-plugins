import { createHash } from "node:crypto";
// Wire contract only; this package does not import the weclio CLI implementation.
export interface Citation {
  source: string;
  source_id?: string;
  url: string;
}

interface DocumentResult {
  identifier: unknown;
  blocks: { content: string; citation?: Citation }[];
}
export type Registry = Map<string, Citation>;

export class CitationError extends Error {
  constructor(readonly code: string, readonly ids: string[], readonly action: string) {
    super(JSON.stringify({ error: code, ids, action }));
  }
}

export function citationId(citation: Citation): string {
  const key = JSON.stringify([citation.source, citation.source_id ?? null, citation.url]);
  return `c${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function validate(citation: Citation, id: string): void {
  if (typeof citation.source !== "string" || !citation.source.trim()) {
    throw new CitationError("EMPTY_CITATION_SOURCE", [id], "Retrieve a citation with a nonempty source; retry.");
  }
  if (typeof citation.url !== "string" || citation.url !== citation.url.trim()) {
    throw new CitationError("INVALID_CITATION_URL", [id], "Retrieve a valid source URL; retry without dropping citations.");
  }
  let url: URL;
  try { url = new URL(citation.url); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new CitationError("INVALID_CITATION_URL", [id], "Retrieve a valid source URL; retry without dropping citations.");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new CitationError("INVALID_CITATION_URL", [id], "Retrieve an HTTP(S) source URL; retry.");
  }
}

export function register(registry: Registry, citation: Citation): string {
  const id = citationId(citation);
  validate(citation, id);
  registry.set(id, {
    source: citation.source,
    ...(citation.source_id === undefined ? {} : { source_id: citation.source_id }),
    url: citation.url,
  });
  return id;
}

// 直接扫描单括号前缀，空 ID 和未闭合标记也必须报错；不解析 Markdown。
const SINGLE_MARKER = /(?<![\\\[])\[cite:([^\[\]\n]*)/g;

export function hasCitationMarker(text: string): boolean {
  return /(?<!\\)\[\[cite:/.test(text) || text.search(SINGLE_MARKER) !== -1;
}

export function render(
  text: string,
  registry: Registry,
  onError: (error: CitationError) => void = (error) => { throw error; },
): string {
  const rendered = text.replace(/(?<!\\)\[\[cite:([^\[\]\n]*)\]\]/g, (marker, id: string) => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new CitationError("INVALID_CITATION_MARKER", [id], "Use the exact [[cite:ID]] from supporting evidence; retry.");
      }
      const citation = registry.get(id);
      if (!citation) {
        throw new CitationError("UNKNOWN_CITATION_ID", [id], "Use registered IDs from supporting evidence; retry without dropping citations.");
      }
      validate(citation, id);
      const source = citation.source.replace(/[\\[\]\r\n]/g, (character) => /[\r\n]/.test(character) ? " " : `\\${character}`);
      const url = citation.url.replace(/[\s()<>\\]/g, (character) => character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character));
      return `[${source}](${url})`;
    } catch (error) {
      if (!(error instanceof CitationError)) throw error;
      onError(error);
      return marker;
    }
  });
  if (/(?<!\\)\[\[cite:/.test(rendered.replace(/(?<!\\)\[\[cite:[^\[\]\n]*\]\]/g, ""))) {
    onError(new CitationError("INVALID_CITATION_MARKER", [], "Use the complete [[cite:ID]] from supporting evidence; retry."));
  }
  for (const match of text.matchAll(SINGLE_MARKER)) {
    onError(new CitationError("INVALID_CITATION_MARKER", [match[1]!],
      "Use the exact [[cite:ID]] from supporting evidence with two pairs of square brackets; retry without changing the claim."));
  }
  return rendered;
}

function documents(text: string): DocumentResult[] | undefined {
  const input = text.trim();
  if (!input.startsWith("{") || !input.includes('"identifier"') || !input.includes('"blocks"')) return;
  // Without a wire type tag, only treat incomplete output as a citation
  // document when it contains evidence of the citation-bearing block shape.
  const looksCited = /"identifier"\s*:/.test(input) && /"blocks"\s*:\s*\[/.test(input)
    && /"content"\s*:\s*"/.test(input) && /"citation"\s*:\s*\{/.test(input);
  const incomplete = (): undefined => {
    if (looksCited) {
      throw new CitationError("INCOMPLETE_CITATION_DOCUMENT", [], "Read the complete CLI JSON; retry.");
    }
    return undefined;
  };
  const values: unknown[] = [];
  let depth = 0, quoted = false, escaped = false, start = 0;
  for (let i = 0; i < input.length; i++) {
    const character = input[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) {
        try { values.push(JSON.parse(input.slice(start, i + 1))); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return incomplete();
        }
        start = i + 1;
      }
    }
  }
  if (depth !== 0 || quoted) return incomplete();
  // A complete JSON value followed by logs is not a document-only result.
  if (input.slice(start).trim()) return;
  if (!values.length || !values.every((value: any) => value?.identifier && Array.isArray(value.blocks) && value.blocks.every((block: any) => block !== null && typeof block === "object" && typeof block.content === "string"))) return;
  return values as DocumentResult[];
}

export function annotateCli(text: string, add: (citation: Citation) => string): string {
  const docs = documents(text);
  if (!docs?.some((doc) => doc.blocks.some((block) => block.citation))) return text;
  return docs.map((doc) => JSON.stringify({
    ...doc,
    blocks: doc.blocks.map((block) => block.citation ? {
      ...block,
      content: `${block.content}\n\n[[cite:${add(block.citation)}]]`,
    } : block),
  })).join("\n");
}
