# Autofix Console

本地 Web 控制台，用于查看和操作 `loop-autofix`。它直接读取 `~/autofix` 的真实状态，不复制队列，也不替代流水线脚本。

## 能力

- 总览：主进程、通知任务、版本、worktree、队列、状态标记、最近事件。
- 任务：当前任务、队列、`manual/` 人工跟进资料、阶段产物、diff、review、日志和附件。
- 日志：进度、launchd、通知、依赖、main 同步和当前任务输出，支持实时跟随、搜索、复制和下载；实时流不可用时自动切换轮询。
- 配置：完整预览 `.env` 与白名单参数；未登记变量只读展示，敏感字段只显示“已配置 / 已脱敏”，支持保存后确认重启主流水线。
- 诊断：检查命令、路径、launchd、版本、token、队列、worktree 和 glab 登录状态。
- 运维：启动、暂停取任务、恢复、停止、重启、通知任务、版本同步、队列维护、worktree 重建和回归测试。

## 技术结构

```text
autofix-console/
├── server/          Node.js ESM API、状态快照、动作执行、SSE
├── web/             Vue 3 + Vite 前端
├── scripts/         开发、构建、启动脚本
├── launchd/         可选的 com.autofix.console LaunchAgent
└── tests/           node:test 后端测试
```

文件系统是唯一状态源。控制台只在 `.data/audit.jsonl` 保存动作审计，不建数据库。

## 安装

需要 Node.js、pnpm，以及 `loop-autofix` 已安装到 `~/autofix/app`。

```bash
cd /Users/admin/01/autofix-console
pnpm install
pnpm build
```

## 启动

生产模式：

```bash
pnpm start
```

打开 <http://127.0.0.1:4177>。

开发模式（API `4177` + Vite `5176`）：

```bash
pnpm dev
```

打开 <http://127.0.0.1:5176>。

## 开机自动启动（可选）

控制台本身默认不安装 LaunchAgent。确认 `pnpm build` 已成功后执行：

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cp /Users/admin/01/autofix-console/launchd/com.autofix.console.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.autofix.console.plist
```

查看日志：

```bash
tail -f ~/Library/Logs/autofix-console.log
```

卸载：

```bash
launchctl unload ~/Library/LaunchAgents/com.autofix.console.plist
rm ~/Library/LaunchAgents/com.autofix.console.plist
```

## 状态与暂停语义

- 控制台只监听 `127.0.0.1`，没有远程访问和多用户登录。
- 启动和停止作用于 `com.autofix`，不会自动加载通知任务。
- “暂停取任务”写入 `~/autofix/runs/paused`：停止同步和取新任务，当前任务继续跑完。
- `blocked` 表示 worktree 未就绪；`halt` 表示队列或清理失败，语义与主动暂停不同。
- 停止使用 skill 的 `stop.sh`，保留队列、`current`、worktree 和代码改动。
- 版本号来自 skill 根目录 `VERSION`；同步逻辑与 `/loop-autofix` 使用的 `sync-version.sh` 一致。

## 安全边界

- 写请求必须带启动时生成的 CSRF token，并校验 localhost Origin。
- 所有动作使用后端固定 allowlist，不执行客户端传入的任意 shell。
- 文件访问限制在任务目录和日志 allowlist 内，拒绝路径穿越。
- token 不写入 API 响应、前端日志或审计日志。
- 动作串行执行；破坏性操作需要确认，部分操作需要输入确认文本。
- 配置保存使用临时文件 + rename，并生成带时间戳的 `.bak` 备份。
- 配置页只回传脱敏后的值；敏感项永远不会通过 API 或审计日志返回明文。

## 测试

```bash
pnpm test
pnpm build
```

`node:test` 覆盖配置解析、路径安全、日志偏移、状态快照、动作互斥、环境诊断、HTTP 路由和任务文件访问。

## 常见问题

- 4177 被占用：启动前释放端口，或设置 `AUTOFIX_CONSOLE_PORT` 后同时调整 `launchd/com.autofix.console.plist`。
- 页面提示“前端尚未构建”：在 `autofix-console` 下执行 `pnpm build`。
- 诊断提示命令缺失：优先按诊断项里的修复命令处理；launchd 的 `PATH` 与交互式终端可能不同。
- 控制台无法启动流水线：先看配置页的诊断和运维页 job 输出，再检查 `~/Library/LaunchAgents/com.autofix.plist`。
