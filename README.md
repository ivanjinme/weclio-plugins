# Weclio Pi Plugins

Monorepo for Pi extensions maintained by Weclio. Each directory under `extensions/` is an independently versioned and publishable npm package.

## Packages

| Package | Entry point | Purpose |
| --- | --- | --- |
| `@weclio/pi-web-search` | `extensions/pi-web-search/index.ts` | Enables native OpenAI Responses web search. |
| `@weclio/pi-submarine` | `extensions/pi-submarine/src/index.ts` | Delegates focused work to foreground child Pi sessions. |

## Local development

Install workspace development dependencies once:

```bash
npm install
```

Load local packages from a Pi project's `.pi/settings.json`:

```json
{
  "extensions": [
    "D:/ivanj/Documents/0-1/2_product/weclio/weclio-plugins/extensions/pi-web-search",
    "D:/ivanj/Documents/0-1/2_product/weclio/weclio-plugins/extensions/pi-submarine"
  ]
}
```

After changing an extension, reload the Pi session; in pi-web, use its extension reload action or restart the development server.

## Checks

```bash
npm run check
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
