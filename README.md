# @weclio/pi-web-search

A [Pi](https://github.com/earendil-works/pi-mono) extension that enables native web search for supported OpenAI Responses APIs.

## Install

Install into a Pi project:

```bash
pi install -l npm:@weclio/pi-web-search
```

Then reload an active session with `/reload`.

## Behavior

- Adds the native `{ type: "web_search" }` tool to supported OpenAI Responses requests.
- Adds web-search guidance to the system prompt when the extension is active.
- Removes OpenAI UTM query parameters from assistant text.
- Set `PI_WEB_SEARCH=0` (or `false`, `no`, `off`) to disable it for a run.

## Development

The extension entry point is `extensions/pi-web-search/index.ts`.
