# weclio-plugins

Shared source repository for Weclio Pi extensions and skills.

```text
extensions/  # Pi extensions
skills/      # Pi skills (`<name>/SKILL.md`)
```

This repository is source-only: creating it does not register or load its resources in Pi. Projects can later opt in through a project-local package configuration, Git source, or npm package.

## Included resources

- `extensions/pi-web-search` — enables native web search for supported OpenAI APIs.
