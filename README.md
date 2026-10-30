# Weclio Pi Plugins

Monorepo for Pi extensions maintained by Weclio. Each directory under `extensions/` is an independently versioned and publishable npm package.

## Packages

| Package | Entry point | Purpose |
| --- | --- | --- |
| `@weclio/pi-web-search` | `extensions/pi-web-search/index.ts` | Enables native OpenAI Responses web search. |
| `@weclio/pi-submarine` | `extensions/pi-submarine/src/index.ts` | Delegates focused work to foreground child Pi sessions. |
| `@weclio/pi-citations` | `extensions/pi-citations/index.ts` | Preserves and renders citations in chat and file writes. |
| `@weclio/pi-persona` | `extensions/pi-persona/index.ts` | Replaces only the opening identity with the Weclio toxicologist persona. |

## Local development

Development dependencies are centralized in the workspace root and target Pi 1.0.2 (the current host). Pi subpackages are pinned together through overrides to prevent incompatible mixed versions. Extensions require Pi >=1.0.2; no older-host compatibility path is maintained.

Install workspace development dependencies once:

```bash
npm install
```

Load local packages from a Pi project's `.pi/settings.json`:

```json
{
  "extensions": [
    "D:/ivanj/Documents/0-1/2_product/weclio/weclio-plugins/extensions/pi-web-search",
    "D:/ivanj/Documents/0-1/2_product/weclio/weclio-plugins/extensions/pi-submarine",
    "D:/ivanj/Documents/0-1/2_product/weclio/weclio-plugins/extensions/pi-citations"
  ]
}
```

After changing an extension, reload the Pi session; in pi-web, use its extension reload action or restart the development server.

## Checks

```bash
npm run check
npm run test:citations:pi
npm run pack:all
```

## Release one package

1. Update that package's `version`.
2. Commit and push.
3. Create and push a tag in this form:

```bash
git tag extensions/pi-web-search/v0.1.5
git push origin extensions/pi-web-search/v0.1.5
```

The GitHub workflow derives the package directory from the tag and verifies its version before publishing with npm Trusted Publishing. Replace `pi-web-search` with the relevant extension directory.
