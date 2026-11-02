# @weclio/plugins

Weclio 的 Pi harness extensions：web-search、submarine、citations、persona。

## 安装与更新

```bash
pi install npm:@weclio/plugins
pi update npm:@weclio/plugins
```

安装或更新后重载会话。不要同时启用提供相同 extension 的旧独立包；已有配置由用户手动切换。

## 本地文件交付

```bash
mkdir weclio-plugins
tar -xzf weclio-plugins-0.1.0.tgz -C weclio-plugins
pi install ./weclio-plugins/package
```

目录安装使用原目录，不复制内容；请保留该目录。更新时完整替换安装目录，再重载会话。

## 许可证

本包采用 MIT 许可证。submarine 保留其 MIT 许可证及第三方署名；依赖遵循各自的许可证。
