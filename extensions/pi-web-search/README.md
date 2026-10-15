# @weclio/pi-web-search

Pi extension that enables native web search for supported OpenAI Responses APIs.

## Install

```bash
pi install npm:@weclio/pi-web-search
```

Requires Pi >=1.0.2. Reload the active Pi session after installation.

## Behavior

- Adds the native `{ type: "web_search" }` tool to supported Responses API requests.
- Adds web-search guidance through the independent `systemPromptOptions.sections.web_search` section, without reading or replacing the complete prompt.
- Removes OpenAI UTM query parameters from assistant text.
- Set `PI_WEB_SEARCH=0` to disable.

Supported APIs: `openai-responses`, `azure-openai-responses`, and `openai-codex-responses`.

## Development

The extension entry point is `index.ts`. Development dependencies are shared at the workspace root. Run `npm run check` there, or `npm run typecheck` / `npm test` in this package. For local use, add the package path in a project's `.pi/settings.json` and reload Pi after edits.
