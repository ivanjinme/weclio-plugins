# @weclio/pi-submarine

Weclio-maintained fork of [`pi-submarine`](https://github.com/dnouri/pi-submarine): a Pi extension for delegating focused work to foreground child Pi sessions.

## Install

```bash
pi install npm:@weclio/pi-submarine
```

Reload the active Pi session after installation.

## Tools

```ts
subagent({ agent?, task, model?, context?, cwd? })
subagent_resume({ sessionId, message })
subagent_list({ cwd? })
```

A `subagent` call runs one child session synchronously and returns the child session ID plus its final answer. `fresh` children are isolated; `fork` children inherit a copy of the current conversation branch.

## Development

The extension entry point is `src/index.ts`. Run from this package directory:

```bash
npm run typecheck
npm test
```

For local use, add this package directory to the target Pi project's `.pi/settings.json` `extensions` array, then reload Pi after changes.

## Upstream

This package was imported from upstream `dnouri/pi-submarine`, commit `15ba4da`, and is distributed under the MIT license. The unmodified upstream README is retained as `UPSTREAM.md`; see `NOTICE.md` for attribution.
