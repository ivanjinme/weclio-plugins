# Weclio Plugins

**`@weclio/plugins`** 交付 Weclio 的 4 个 Pi harness extensions，不包含业务 CLI 或 skills。

本仓库采用 [MIT 许可证](LICENSE)；`extensions/pi-submarine` 保留其 MIT 许可证及第三方署名。

## 内容

| Extension | 入口 | 用途 |
| --- | --- | --- |
| web-search | `extensions/pi-web-search/index.ts` | 原生 OpenAI Responses web search |
| submarine | `extensions/pi-submarine/src/index.ts` | 子 Pi 会话委派 |
| citations | `extensions/pi-citations/index.ts` | 引用保留与渲染 |
| persona | `extensions/pi-persona/index.ts` | 会话开头身份定制 |

## 安装

```bash
pi install npm:@weclio/plugins
```

更新、旧包迁移及本地文件安装见[包使用说明](bundle/README.md)。

## 开发与验证

```bash
npm ci
npm run check
npm run test:citations:pi
```

开发依赖集中在根 workspace，Pi SDK 从 1.4.0 起使用 `^` 范围，不打入发布包；`package-lock.json` 保证 CI 安装可复现。typebox 与 Pi SDK 的精确依赖保持一致，避免重复版本导致类型冲突。根目录是开发 workspace；聚合加载应使用下述 `dist/package`。

## 打包

```bash
npm run pack
npm run verify:package -- dist/weclio-plugins-0.1.0.tgz
```

- `dist/package/`：4 个 extensions 的完整目录。
- `dist/weclio-plugins-<version>.tgz`：仅含 harness 的交付文件。

验证器在隔离目录中检查包内容、许可证、扩展加载及离线安装和更新，不修改本机配置。

```bash
pi -e ./dist/package
```

## 发布

1. 更新 `bundle/package.json` 中的聚合包版本。
2. 检查、打包、验证后提交并推送。
3. 推送匹配的 `v<version>` tag，例如 `v0.1.0`。

`.github/workflows/publish.yml` 构建并验证 tarball，再通过 Trusted Publishing 发布并生成 provenance。不要本地运行 `npm publish`。

新包首次发布需要配置发布授权／Trusted Publisher（仓库 `ivanjinme/weclio-plugins`，workflow `publish.yml`）。
