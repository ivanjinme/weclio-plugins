# @weclio/pi-citations

Pi citation extension (`pi-citations`), maintained in the shared plugins workspace. Requires Pi >=1.0.2; no older-host compatibility path is maintained.

## Local use

Load the package explicitly, or add its directory to the target project's `.pi/settings.json` packages and reload Pi:

```sh
pi -e /path/to/weclio-plugins/extensions/pi-citations
```

CLI schemas, cached documents and search behavior stay unchanged. This package has no runtime dependency on the weclio CLI source tree; it defines only the consumed citation/document wire shapes. The companion `pi-web-search` uses `sections.web_search`; citations use `sections.weclio_citations`. Neither extension reads or overrides the complete prompt.

## Flow

- `tool_result`: recognize complete weclio document JSON from bash/read, register `blocks[].citation`, and attach an ID marker to the corresponding evidence block in the model-facing result.
- `provider_stream_event`: collect URL annotations from finalized Responses message items, without mutating events or buffering the stream.
- `message_end`: bind native sources by provider/API/model and the Responses output item ID carried in Pi's version-1 `textSignature`, populate `text.citations`, register sources, and render ID markers in completed assistant text. Never guess bindings from text or output order. Only URLs and optional titles are extracted; provider offsets are omitted because other extensions may rewrite the text.
- Pending annotations are cleared at assistant completion (including errors/aborts), new user runs and branch restoration. Background responses do not overwrite active items: bindings include their output IDs, rather than clearing state on arbitrary HTTP requests.
- `context`: expose ID mappings next to relevant historical native text blocks, not an entire registry/reference appendix. This hook adds no global rule messages. A source associated with a block does not necessarily support every claim in it. Offsets are not used because another extension may have changed the text.
- `tool_call`: render valid markers in `write.content` and all `edit.newText` values before execution, regardless of file path. Never change `oldText`. Unknown or malformed markers remain visible; citation failures never block or retry file operations.
- `session_start` / `session_tree`: restore the active branch's registry from custom entries, including entries before compaction.
- `before_agent_start`: reset repair counters and inject one `weclio_citations` system-prompt section from the first request, even with an empty registry. No complete-prompt override or compatibility branch is used.
- `agent_before_settle`: request continuation only when a chat citation needs repair; at most two repair requests.

CLI/registry citation objects retain exactly `{ source, source_id?, url }`. IDs are hashes of those fields: stable across reload and registration order, without reusing sequential IDs on another branch. Native titles map to `source`; an absent title uses the supplied URL as the label. Registry deltas are persisted with `appendEntry`; full evidence is not duplicated there.

## Markers and files

Use the exact marker supplied alongside evidence. Programmatic rendering supplies the source label and URL; the model must choose a supporting source and preserve citations when rewriting. Existing Markdown/native citations need not be converted back into markers. Source-ID mappings are internal context, not delivery text.

Skills remain usable without the extension: use a supplied marker for its supporting evidence; only when that evidence has no marker, fall back to `[citation.source](citation.url)`.

The standard remains double-bracket `\[[cite:ID]]`; CLI evidence and native-source context mappings always supply that format. Any unescaped single-bracket `\[cite:` prefix is an `INVALID_CITATION_MARKER`, including empty IDs and unclosed markers. Detection scans raw text: Markdown links, images, reference definitions, tables and code provide no exemption. Ordinary `[1]`, `[2]` and `[title](url)` are unchanged. Chat uses the existing bounded repair flow; file writes/edits preserve invalid markers without blocking, retrying or silently converting them into links. No Markdown parser is involved.

To write a literal example rather than a citation, escape its opening bracket: `\[[cite:ID]]` (or `\[cite:ID]` when discussing the typo). Code fences alone are not an escape; unescaped markers in code examples are still checked.

Ordinary files and existing Markdown links pass through unchanged. JSON caches and ordinary report readbacks are not modified on disk. Only complete document JSON receives model-facing evidence markers; unrelated output is untouched. Incomplete documents or invalid citation metadata leave the original tool evidence available rather than replacing it with a citation error.

Chat citation failures send the draft and structured feedback to a hidden repair message, at most twice. Repair instructions require fixing citations only, without changing the draft's wording or conclusions or deleting markers to evade repair. After two unsuccessful retries, the draft is delivered normally: valid markers become links and unresolved markers remain visible, e.g. `[[cite:c7]]`. A citation-free retry does not replace the saved draft. Pending repairs survive intervening tool calls. No citation failure produces a user-facing error or blocks a file operation. Streamed drafts may temporarily contain unresolved markers; no stream buffering is added.

## Boundaries

- Supported CLI ingestion: document results with `identifier` and `blocks`. Other CLI shapes retain the existing manual citation fallback.
- Native extraction supports OpenAI Responses message-item URL annotations (including Codex/Azure Responses). It works on unpatched Pi 1.0.2 using public hooks; no host patch, installation script or SDK file mutation is needed. Other provider annotation formats are not inferred. Already supplied native metadata remains usable when no matching raw item is collected.
- Missing markers and semantic support are not inferred or verified. The repair guard rejects a citation-free retry, but does not prove every original citation was retained or that the model followed the wording-preservation instruction. The extension never removes, retracts or weakens conclusions. Existing broken Markdown is not automatically repaired.
- Bash/scripts writing files are not intercepted. This is citation rendering, not a filesystem security boundary.
- Independent native citations are kept; marker rendering does not reconstruct provider annotations from text.

## Tests

```sh
# From the workspace root
npm run check
npm run test:citations:pi
```

Real Pi hook integration uses a scripted provider and a localhost Responses SSE server, without external network calls or credentials:

```sh
# From this package directory
npm run test:integration
```

The integration runners default to the workspace Pi and sibling `pi-web-search` source. Optionally set `PI_CLI` or `PI_WEB_SEARCH_EXTENSION` to override them. The HTTP suite requires an unpatched Pi SDK and verifies actual Responses parsing, native metadata, subsequent model context, file/chat rendering and persisted session metadata in both extension load orders, plus a negative control without citations. The scripted suite additionally covers first-request system rules, repeated-run deduplication, search disablement, canonical double-bracket CLI/native mappings, escaped literal examples, Markdown fallback with/without the extension, mixed sources, chat repair and graceful fallback, arbitrary-path writes, mixed-validity edits, retry limits, session restore, compaction and branch isolation. Regression cases cover raw single-marker detection (including empty and unclosed markers), Markdown non-exemption, repair exhaustion and citation-free evasion, and mixed single/double content.
