# @weclio/pi-web-search

A [Pi](https://github.com/earendil-works/pi-mono) extension that enables native web search for supported OpenAI Responses APIs.

## Install

Install into a Pi project:

```bash
pi install -l npm:@weclio/pi-web-search
```

Then reload an active session with `/reload`.

### Enable

Works with any model whose **API** is `openai-responses`, `azure-openai-responses`, or `openai-codex-responses`. For a custom provider, set its **Base URL** and **API** type under **Settings → Models** (see [models.dev](https://models.dev/) for details).

## Behavior

- Adds the native `{ type: "web_search" }` tool to Responses requests and web-search guidance to the system prompt.
- Removes OpenAI UTM query parameters from assistant text.
- Set `PI_WEB_SEARCH=0` to disable.

## Development

The extension entry point is `extensions/pi-web-search/index.ts`.

## Release

Publishing is automated through GitHub Actions and an npm Trusted Publisher. To release a new version, update `package.json`, commit it, then create and push a matching version tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The `v0.1.1` tag must match the `version` in `package.json`.
