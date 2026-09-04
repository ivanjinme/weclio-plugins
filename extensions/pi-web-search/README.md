# @weclio/pi-web-search

Pi extension that enables native web search for supported OpenAI Responses APIs.

## Install

```bash
pi install npm:@weclio/pi-web-search
```

Reload the active Pi session after installation.

## Behavior

- Adds the native `{ type: "web_search" }` tool to supported Responses API requests.
- Adds web-search guidance to the system prompt.
- Removes OpenAI UTM query parameters from assistant text.
- Set `PI_WEB_SEARCH=0` to disable.

Supported APIs: `openai-responses`, `azure-openai-responses`, and `openai-codex-responses`.

## Development

The extension entry point is `index.ts`. From the repository root, use the local path in a project's `.pi/settings.json` and reload Pi after edits.
