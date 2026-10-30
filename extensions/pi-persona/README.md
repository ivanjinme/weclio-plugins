# @weclio/pi-persona

仅将系统提示词的身份首段替换为 Weclio 毒理专家，沿用 `weclio-tra/.pi/SYSTEM.md` 的身份文本。
工具、规则、文档、skills 和其他提示词正文保持不变。不添加工具、命令、配置或运行依赖。

在本仓库根目录试用：

```bash
pi -e ./extensions/pi-persona
```

发布后可通过 `pi install npm:@weclio/pi-persona` 安装。

若要继续继承 Pi 默认提示词的更新，需先停用原来的整份 `SYSTEM.md` 快照；本扩展不会删除或修改它。
通过 `context_with_system` 在发送请求时生效，不改写会话存档；显式的纯文本强制提示词不处理。
